import * as vscode from 'vscode';

import { Controller } from './controller';
import { ApiClient } from './core/api';
import { CredentialStore, ensureMultiSessionDir } from './core/credstore';
import { LogLevel, Logger } from './core/log';
import { ProfileStore } from './core/profiles';
import { showDoctor } from './ui/doctor';
import { oneLine } from './ui/format';
import { PassphraseHolder } from './ui/passphrase';
import { showAccountSwitcher } from './ui/quickpick';
import { signInAgain } from './ui/reauth';
import { StatusBar } from './ui/statusbar';
import { runSyncSetup } from './ui/syncSetup';
import { AccountsTree } from './ui/tree';
import { runAddAccountWizard } from './ui/wizard';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('Claude Multi Session', { log: true });
  const log = makeLogger(output);
  const version = (context.extension.packageJSON as { version?: string }).version ?? '0.0.0';

  await ensureMultiSessionDir();

  const store = new ProfileStore(process.env, log);
  const credentials = new CredentialStore({ logger: log });
  const api = new ApiClient({ logger: log });
  const passphrase = new PassphraseHolder(context.secrets, log);
  const claudeMultiSession = new Controller(context, log, store, credentials, api, passphrase);

  const statusBar = new StatusBar(claudeMultiSession);
  const tree = new AccountsTree(claudeMultiSession);
  const treeView = vscode.window.createTreeView('claudeMultiSession.accounts', {
    treeDataProvider: tree,
    showCollapseAll: true,
  });

  context.subscriptions.push(
    output,
    claudeMultiSession,
    statusBar,
    tree,
    treeView,
    passphrase.onDidChange(() => claudeMultiSession.notifyChanged()),
  );

  const register = (command: string, handler: (...args: never[]) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(command, handler));
  };

  register('claudeMultiSession.switch', () => showAccountSwitcher(claudeMultiSession));

  register('claudeMultiSession.switchToAccount', async (accountId: string) => {
    // Picking a revoked account means "make this work again", not "switch".
    const profile = claudeMultiSession.store.get(accountId);
    if (profile?.needsSignIn) {
      await signInAgain(claudeMultiSession, profile);
      return;
    }
    const result = await claudeMultiSession.switchTo(accountId);
    if (result.ok) {
      void vscode.window.showInformationMessage(result.message);
      return;
    }
    // A switch refused because the sign-in is revoked has an obvious next step.
    const choice = await vscode.window.showWarningMessage(
      result.message,
      ...(result.revoked ? ['Sign in again'] : []),
    );
    if (choice === 'Sign in again') await signInAgain(claudeMultiSession, profile);
  });

  register('claudeMultiSession.refresh', async () => {
    await vscode.window.withProgress(
      { location: { viewId: 'claudeMultiSession.accounts' }, title: 'Refreshing usage' },
      () => claudeMultiSession.refresh({ force: true }),
    );
    const active = claudeMultiSession.activeView();
    if (active) void vscode.window.setStatusBarMessage(`Claude Multi Session: ${oneLine(active)}`, 6000);
  });

  register('claudeMultiSession.captureCurrent', async () => {
    await claudeMultiSession.captureCurrent();
  });

  register('claudeMultiSession.addAccount', () => runAddAccountWizard(claudeMultiSession));

  register('claudeMultiSession.signInAgain', async (argument?: unknown) => {
    const accountId = await resolveAccountId(
      claudeMultiSession,
      argument,
      'Sign in again as which account?',
    );
    await signInAgain(claudeMultiSession, accountId ? claudeMultiSession.store.get(accountId) : undefined);
  });

  register('claudeMultiSession.renameAccount', async (argument?: unknown) => {
    const accountId = await resolveAccountId(claudeMultiSession, argument, 'Rename which account?');
    if (!accountId) return;
    const profile = claudeMultiSession.store.get(accountId);
    if (!profile) return;
    const label = await vscode.window.showInputBox({
      title: 'Rename account',
      value: profile.label,
      ignoreFocusOut: true,
      validateInput: (value) => (value.trim() ? undefined : 'A name is required.'),
    });
    if (!label) return;
    await claudeMultiSession.renameAccount(accountId, label.trim());
  });

  register('claudeMultiSession.removeAccount', async (argument?: unknown) => {
    const accountId = await resolveAccountId(claudeMultiSession, argument, 'Remove which account?');
    if (!accountId) return;
    const profile = claudeMultiSession.store.get(accountId);
    if (!profile) return;
    const isActive = claudeMultiSession.store.state.activeAccountId === accountId;
    const choice = await vscode.window.showWarningMessage(
      `Remove “${profile.label}” from Claude Multi Session?`,
      {
        modal: true,
        detail: isActive
          ? 'This is the account in use. Claude Code stays signed in to it, but Claude Multi Session will no longer hold a copy of the sign-in, so you could not switch back to it without signing in again.'
          : 'Claude Code is not using this account. Claude Multi Session will forget its sign-in; you would need to sign in again to use it.',
      },
      'Remove',
    );
    if (choice !== 'Remove') return;
    await claudeMultiSession.removeAccount(accountId);
  });

  register('claudeMultiSession.doctor', () => showDoctor(claudeMultiSession, version));

  register('claudeMultiSession.copySummary', async () => {
    const views = claudeMultiSession.views();
    if (views.length === 0) {
      void vscode.window.showInformationMessage('No accounts to summarise yet.');
      return;
    }
    const text = views
      .map((view) => `${view.isActive ? '*' : '-'} ${view.profile.label}: ${oneLine(view)}`)
      .join('\n');
    await vscode.env.clipboard.writeText(text);
    void vscode.window.showInformationMessage('Usage summary copied.');
  });

  register('claudeMultiSession.syncSetup', () => runSyncSetup(claudeMultiSession));

  register('claudeMultiSession.syncPull', async () => {
    try {
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Pulling accounts' },
        () => claudeMultiSession.sync.pull({ purpose: 'read your synced accounts' }),
      );
      void vscode.window.showInformationMessage(result.message);
      await claudeMultiSession.refresh({ force: true });
    } catch (error) {
      claudeMultiSession.reportQuietly('sync pull', error);
    }
  });

  register('claudeMultiSession.syncPush', async () => {
    try {
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Pushing accounts' },
        () => claudeMultiSession.sync.push('manual push'),
      );
      void vscode.window.showInformationMessage(result.message);
    } catch (error) {
      claudeMultiSession.reportQuietly('sync push', error);
    }
  });

  register('claudeMultiSession.unlock', async () => {
    const passphraseValue = await passphrase.get('unlock your synced accounts');
    if (!passphraseValue) return;
    await vscode.commands.executeCommand('claudeMultiSession.syncPull');
  });

  register('claudeMultiSession.lock', async () => {
    await passphrase.lock();
    void vscode.window.showInformationMessage('Claude Multi Session locked. The passphrase will be asked for again when needed.');
  });

  register('claudeMultiSession.toggleFailover', async () => {
    const configuration = vscode.workspace.getConfiguration();
    const next = !configuration.get<boolean>('claudeMultiSession.failover.enabled', false);
    await configuration.update('claudeMultiSession.failover.enabled', next, vscode.ConfigurationTarget.Global);
    void vscode.window.showInformationMessage(
      next
        ? 'Auto-failover is on. When the account in use runs out, Claude Multi Session will move to the account whose weekly quota expires soonest.'
        : 'Auto-failover is off.',
    );
  });

  register('claudeMultiSession.showLogs', () => output.show(true));

  register('claudeMultiSession.openWalkthrough', () =>
    vscode.commands.executeCommand(
      'workbench.action.openWalkthrough',
      `${context.extension.id}#claudeMultiSession.gettingStarted`,
      false,
    ),
  );

  await claudeMultiSession.initialize();
  void maybeGreet(claudeMultiSession);
}

export function deactivate(): void {
  /* disposables handle everything */
}

async function maybeGreet(claudeMultiSession: Controller): Promise<void> {
  if (claudeMultiSession.store.state.firstRunShown) return;
  await claudeMultiSession.store.patchState({ firstRunShown: true });

  const hasAccount = claudeMultiSession.store.list().length > 0;
  const choice = await vscode.window.showInformationMessage(
    hasAccount
      ? 'Claude Multi Session is showing your Claude quota in the status bar. Click it to see both windows and to switch accounts.'
      : 'Claude Multi Session is installed. Sign in with Claude Code and it will start showing how much quota you have left.',
    'Open walkthrough',
    'Add another account',
  );
  if (choice === 'Open walkthrough') await vscode.commands.executeCommand('claudeMultiSession.openWalkthrough');
  if (choice === 'Add another account') await vscode.commands.executeCommand('claudeMultiSession.addAccount');
}

async function resolveAccountId(
  claudeMultiSession: Controller,
  argument: unknown,
  title: string,
): Promise<string | undefined> {
  if (typeof argument === 'string') return argument;
  const fromTree = (argument as { view?: { profile?: { id?: string } } } | undefined)?.view?.profile?.id;
  if (fromTree) return fromTree;

  const views = claudeMultiSession.views();
  if (views.length === 0) {
    void vscode.window.showInformationMessage('No accounts are saved.');
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    views.map((view) => ({
      label: view.profile.label,
      description: view.isActive ? 'in use' : '',
      detail: oneLine(view),
      id: view.profile.id,
    })),
    { title, ignoreFocusOut: true },
  );
  return picked?.id;
}

function makeLogger(output: vscode.LogOutputChannel): Logger {
  const enabled = (level: LogLevel): boolean => {
    const configured = vscode.workspace
      .getConfiguration()
      .get<LogLevel>('claudeMultiSession.logLevel', 'info');
    const order: LogLevel[] = ['error', 'warn', 'info', 'debug'];
    return order.indexOf(level) <= order.indexOf(configured);
  };
  return {
    error: (message) => output.error(message),
    warn: (message) => {
      if (enabled('warn')) output.warn(message);
    },
    info: (message) => {
      if (enabled('info')) output.info(message);
    },
    debug: (message) => {
      if (enabled('debug')) output.debug(message);
    },
  };
}
