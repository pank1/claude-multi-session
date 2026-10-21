import * as vscode from 'vscode';

import { Controller } from '../controller';
import { signInAgain } from './reauth';

/**
 * Adding another account.
 *
 * Claude Multi Session never performs the sign-in itself (D-02): Anthropic's
 * own flow does that, and this wizard only saves what comes out of it. It
 * drives `claude auth login` rather than asking you to go and run something —
 * an earlier version waited silently for a sign-in it had not started, which
 * was indistinguishable from the extension having hung (D-18).
 *
 * It must never sign you out to get there. Logging out of Claude Code revokes
 * the whole token family server-side — the access token *and* the refresh
 * token — so a logout between accounts destroys the sign-in just saved (D-16).
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
        '2. Open Anthropic sign-in in a terminal and your browser.',
        '3. Save the account you sign in as, so you can move between them from the status bar.',
        '',
        'You are never signed out: logging out would revoke the account being left.',
        'You can stop at any point. Nothing is sent anywhere.',
      ].join('\n'),
    },
    'Start',
  );
  if (start !== 'Start') return;

  await claudeMultiSession.captureCurrent({ silent: true });
  await signInAgain(claudeMultiSession);

  const total = claudeMultiSession.store.list().length;
  if (total < 2) return;

  const next = await vscode.window.showInformationMessage(
    `You have ${total} accounts; click the status bar to move between them.`,
    ...(claudeMultiSession.settings().sync.enabled ? ['Push to sync'] : ['Set up sync']),
  );
  if (next === 'Push to sync') await vscode.commands.executeCommand('claudeMultiSession.syncPush');
  if (next === 'Set up sync') await vscode.commands.executeCommand('claudeMultiSession.syncSetup');
}
