import * as vscode from 'vscode';

import { Controller } from '../controller';
import { StoredCredentials } from '../core/types';

const SIGN_IN_HINTS = [
  'claude-vscode.newConversation',
  'claude-vscode.editor.open',
  'claude-vscode.sidebar.open',
];

/**
 * Adding a second account.
 *
 * Claude Multi Session never performs the sign-in itself (D-02): Claude Code's
 * own login does that, and this wizard only saves what comes out of it.
 *
 * It must never sign you out to get there. Logging out of Claude Code revokes
 * the whole token family server-side — the access token *and* the refresh
 * token — so a logout between accounts destroys the sign-in that was just
 * saved. An earlier version of this wizard did exactly that, and quietly killed
 * every account it had collected (D-16). `/login` replaces the credential file
 * on its own, which revokes nothing.
 */
export async function runAddAccountWizard(claudeMultiSession: Controller): Promise<void> {
  const existing = claudeMultiSession.store.list();
  const start = await vscode.window.showInformationMessage(
    'Add another Claude account',
    {
      modal: true,
      detail: [
        'Claude Multi Session will:',
        '',
        `1. Save the account you are using now${existing.length > 0 ? ' (if it is not saved already)' : ''}.`,
        '2. Wait while you sign in with the other account.',
        '3. Save that one too, so you can move between them from the status bar.',
        '',
        'Use /login in a Claude Code session — NOT Logout.',
        'Logging out revokes the sign-in for the account you are leaving, and',
        'this extension would lose it.',
        '',
        'You can stop at any point. Nothing is sent anywhere.',
      ].join('\n'),
    },
    'Start',
  );
  if (start !== 'Start') return;

  const saved = await claudeMultiSession.captureCurrent({ silent: true });
  const known = new Set(
    claudeMultiSession.store.list().map((profile) => profile.credentials.claudeAiOauth.refreshToken),
  );

  const go = await vscode.window.showInformationMessage(
    'Now sign in with the other account',
    {
      modal: true,
      detail: [
        'In a Claude Code session, run:',
        '',
        '    /login',
        '',
        'and sign in with the other account. Claude Code replaces its stored',
        'sign-in, which leaves the one just saved intact.',
        '',
        'Do not use Logout — that revokes the account you are leaving.',
      ].join('\n'),
    },
    'I am signing in now',
  );
  if (go !== 'I am signing in now') return;

  const fresh = await waitForNewLogin(claudeMultiSession, known);
  if (!fresh) {
    const retry = await vscode.window.showWarningMessage(
      saved
        ? `No new sign-in was detected. “${saved.label}” is still saved — switch back to it from the status bar whenever you like.`
        : 'No new sign-in was detected.',
      'Open Claude Code',
    );
    if (retry === 'Open Claude Code') {
      const available = await vscode.commands.getCommands(true);
      for (const command of SIGN_IN_HINTS) {
        if (available.includes(command)) {
          await vscode.commands.executeCommand(command);
          break;
        }
      }
    }
    return;
  }

  const profile = await claudeMultiSession.captureCurrent({ silent: true });
  if (!profile) {
    void vscode.window.showWarningMessage('The new sign-in could not be saved. Run Claude Multi Session: Doctor for detail.');
    return;
  }

  const label = await vscode.window.showInputBox({
    title: 'Name this account',
    value: profile.label,
    prompt: 'Only you see this. The email address works well.',
    ignoreFocusOut: true,
  });
  if (label && label.trim() && label.trim() !== profile.label) {
    await claudeMultiSession.renameAccount(profile.id, label.trim());
  }

  const total = claudeMultiSession.store.list().length;
  const next = await vscode.window.showInformationMessage(
    `Saved. You now have ${total} account${total === 1 ? '' : 's'}; click the status bar to move between them.`,
    ...(claudeMultiSession.settings().sync.enabled ? ['Push to sync'] : ['Set up sync']),
  );
  if (next === 'Push to sync') await vscode.commands.executeCommand('claudeMultiSession.syncPush');
  if (next === 'Set up sync') await vscode.commands.executeCommand('claudeMultiSession.syncSetup');
}

/**
 * Watches the credential store for a sign-in we have not seen before. Polling
 * is deliberate: a file watcher misses the macOS keychain, and two seconds is
 * imperceptible next to typing a password.
 */
async function waitForNewLogin(
  claudeMultiSession: Controller,
  known: Set<string>,
): Promise<StoredCredentials | undefined> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Waiting for the next Claude sign-in…',
      cancellable: true,
    },
    async (progress, token) => {
      progress.report({ message: 'Sign in with the other account in Claude Code.' });
      const deadline = Date.now() + 10 * 60_000;
      while (Date.now() < deadline && !token.isCancellationRequested) {
        const current = await claudeMultiSession.credentials.read();
        const refresh = current?.claudeAiOauth.refreshToken;
        if (current && refresh && !known.has(refresh)) return current;
        await delay(2000);
      }
      return undefined;
    },
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
