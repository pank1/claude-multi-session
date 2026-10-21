import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import * as vscode from 'vscode';

import { Controller } from '../controller';
import { Profile } from '../core/types';

const run = promisify(execFile);

/** The official extension's id, whose bundled binary we fall back to. */
const CLAUDE_EXTENSION = 'anthropic.claude-code';

/**
 * Locates the Claude CLI: whatever is on PATH, else the binary the official
 * extension ships. Someone who uses Claude Code only inside VS Code has no
 * `claude` on PATH at all, and telling them to run a command they do not have
 * is not help.
 */
export async function resolveClaudeCommand(): Promise<string | undefined> {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  try {
    const { stdout } = await run(probe, ['claude'], { timeout: 5000 });
    const first = stdout.split('\n')[0]?.trim();
    if (first) return first;
  } catch {
    /* not on PATH; try the extension's own copy */
  }

  const extension = vscode.extensions.getExtension(CLAUDE_EXTENSION);
  if (!extension) return undefined;
  const binary = path.join(
    extension.extensionPath,
    'resources',
    'native-binary',
    process.platform === 'win32' ? 'claude.exe' : 'claude',
  );
  try {
    await fs.access(binary);
    return binary;
  } catch {
    return undefined;
  }
}

/**
 * Takes you to Anthropic's sign-in and waits for the result.
 *
 * `claude auth login` is the official flow — it opens the browser and writes the
 * credentials when it finishes — so this drives that rather than asking you to
 * type a command. When a revoked account is named, its address is pre-filled on
 * the login page, which is the difference between "sign in again" and "sign in
 * again, as which one?".
 */
export async function signInAgain(controller: Controller, target?: Profile): Promise<void> {
  const command = await resolveClaudeCommand();
  if (!command) {
    const choice = await vscode.window.showErrorMessage(
      'Could not find the Claude command on this machine, so the sign-in cannot be started for you. Run `claude auth login` in a terminal, then use "Save Current Login".',
      'Save Current Login',
    );
    if (choice === 'Save Current Login') {
      await vscode.commands.executeCommand('claudeMultiSession.captureCurrent');
    }
    return;
  }

  const email = target?.identity?.email;
  const known = new Set(
    controller.store.list().map((profile) => profile.credentials.claudeAiOauth.refreshToken),
  );

  const terminal = vscode.window.createTerminal({ name: 'Claude sign-in' });
  terminal.show(true);
  terminal.sendText(
    `"${command}" auth login --claudeai${email ? ` --email ${shellArg(email)}` : ''}`,
    true,
  );

  const signedIn = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: target ? `Signing in again as ${target.label}` : 'Signing in to another Claude account',
      cancellable: true,
    },
    async (progress, token) => {
      progress.report({ message: 'finish the sign-in in the terminal and your browser…' });
      const deadline = Date.now() + 10 * 60_000;
      while (Date.now() < deadline && !token.isCancellationRequested) {
        const current = await controller.credentials.read();
        const refresh = current?.claudeAiOauth.refreshToken;
        if (refresh && !known.has(refresh)) return true;
        await delay(1500);
      }
      return false;
    },
  );

  if (!signedIn) {
    void vscode.window.showWarningMessage(
      'No new sign-in was detected. The terminal is still open if you want to finish it — then run "Save Current Login".',
    );
    return;
  }

  const saved = await controller.captureCurrent({ silent: true });
  if (!saved) {
    void vscode.window.showWarningMessage('Signed in, but the account could not be saved. Run Doctor for detail.');
    return;
  }

  // The sign-in page does not force which account you choose, so the one that
  // came back is not necessarily the one asked for.
  if (target && saved.id !== target.id) {
    const choice = await vscode.window.showWarningMessage(
      `Signed in as ${saved.label}, not ${target.label}. ${target.label} is still revoked.`,
      `Try ${target.label} again`,
      'Leave it',
    );
    if (choice === `Try ${target.label} again`) await signInAgain(controller, target);
    return;
  }

  void vscode.window.showInformationMessage(`${saved.label} is signed in again and ready to use.`);
}

function shellArg(value: string): string {
  return /^[A-Za-z0-9@._+-]+$/.test(value) ? value : `"${value.replace(/(["$`\\])/g, '\\$1')}"`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
