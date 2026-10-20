import * as vscode from 'vscode';

import { Controller } from '../controller';

/**
 * Sets up the encrypted bundle in the user's own private repository. Two paths:
 * this is the first machine, or another machine already created the bundle.
 */
export async function runSyncSetup(claudeMultiSession: Controller): Promise<void> {
  const intro = await vscode.window.showInformationMessage(
    'Carry your accounts between machines',
    {
      modal: true,
      detail: [
        'Your accounts are put into a single file, encrypted with a passphrase you choose, and committed to a private git repository that you own.',
        '',
        'Any machine with that repository and the passphrase has every account, with no further signing in.',
        '',
        'Use a private repository. Only the encrypted file and a small "which machine is on which account" note are written to it.',
      ].join('\n'),
    },
    'Continue',
  );
  if (intro !== 'Continue') return;

  const configuration = vscode.workspace.getConfiguration();
  const repository = await vscode.window.showInputBox({
    title: 'Sync repository',
    prompt: 'The git remote for your private accounts repository.',
    placeHolder: 'git@github.com:you/claude-accounts.git',
    value: configuration.get<string>('claudeMultiSession.sync.repository', ''),
    ignoreFocusOut: true,
    validateInput: (value) => {
      const trimmed = value.trim();
      if (!trimmed) return 'A git remote is required.';
      if (!/^(git@|ssh:\/\/|https:\/\/|file:\/\/|\/)/.test(trimmed)) {
        return 'That does not look like a git remote.';
      }
      return undefined;
    },
  });
  if (!repository) return;

  const branch =
    (await vscode.window.showInputBox({
      title: 'Branch',
      value: configuration.get<string>('claudeMultiSession.sync.branch', 'main'),
      ignoreFocusOut: true,
    })) ?? 'main';

  const role = await vscode.window.showQuickPick(
    [
      {
        label: '$(cloud-upload) This is the first machine',
        detail: 'Create the encrypted bundle from the accounts saved here and push it',
        value: 'create' as const,
      },
      {
        label: '$(cloud-download) Another machine already set this up',
        detail: 'Pull the existing bundle and add its accounts to this machine',
        value: 'join' as const,
      },
    ],
    { title: 'Which is it?', ignoreFocusOut: true },
  );
  if (!role) return;

  const passphrase =
    role.value === 'create'
      ? await claudeMultiSession.passphrase.createNew()
      : await claudeMultiSession.passphrase.get('open the synced accounts');
  if (!passphrase) return;

  // VS Code refuses to write settings.json when it has a syntax error, when a
  // policy or a read-only profile owns it, or mid Settings Sync conflict. Its
  // own wording is "unable to write", which says nothing about where to look —
  // and these three writes used to be outside any try, so that bare message was
  // the whole of what a failing machine told you.
  try {
    await configuration.update('claudeMultiSession.sync.repository', repository.trim(), vscode.ConfigurationTarget.Global);
    await configuration.update('claudeMultiSession.sync.branch', branch.trim() || 'main', vscode.ConfigurationTarget.Global);
    await configuration.update('claudeMultiSession.sync.enabled', true, vscode.ConfigurationTarget.Global);
  } catch (error) {
    claudeMultiSession.log.error(`could not save sync settings: ${String(error)}`);
    const choice = await vscode.window.showErrorMessage(
      'Sync was not set up: VS Code could not save your settings on this machine. That is almost always a syntax error in settings.json — a stray comma or bracket — or a settings file this window is not allowed to edit.',
      'Open settings.json',
      'Show logs',
    );
    if (choice === 'Open settings.json') {
      await vscode.commands.executeCommand('workbench.action.openSettingsJson');
    } else if (choice === 'Show logs') {
      await vscode.commands.executeCommand('claudeMultiSession.showLogs');
    }
    return;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Claude Multi Session sync', cancellable: false },
    async (progress) => {
      try {
        if (role.value === 'create') {
          progress.report({ message: 'encrypting and pushing your accounts…' });
          const result = await claudeMultiSession.sync.push('first push from this machine');
          void vscode.window.showInformationMessage(
            result.pushed
              ? `Sync is on. ${claudeMultiSession.store.list().length} account(s) are now in ${repository.trim()}.`
              : 'Sync is on, but there was nothing new to push.',
          );
        } else {
          progress.report({ message: 'pulling and decrypting…' });
          const result = await claudeMultiSession.sync.pull({ purpose: 'open the synced accounts' });
          void vscode.window.showInformationMessage(result.message);
        }
      } catch (error) {
        claudeMultiSession.reportQuietly('sync setup', error);
        void vscode.window
          .showErrorMessage(
            `Sync could not be set up: ${error instanceof Error ? error.message : String(error)}`,
            'Show logs',
            'Run Doctor',
          )
          .then((choice) => {
            if (choice === 'Show logs') void vscode.commands.executeCommand('claudeMultiSession.showLogs');
            if (choice === 'Run Doctor') void vscode.commands.executeCommand('claudeMultiSession.doctor');
          });
        return;
      }
      await claudeMultiSession.refresh({ force: true });
    },
  );

  if (!configuration.get<boolean>('claudeMultiSession.sync.rememberPassphrase', false)) {
    const remember = await vscode.window.showInformationMessage(
      'Should this machine remember the passphrase in its keychain? Needed if you want auto-failover to work while you are away.',
      'Remember it',
      'Ask me each time',
    );
    if (remember === 'Remember it') {
      await configuration.update('claudeMultiSession.sync.rememberPassphrase', true, vscode.ConfigurationTarget.Global);
      // It is already in memory; put it in the keychain without asking again.
      await claudeMultiSession.passphrase.persist();
    }
  }
}
