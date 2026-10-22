import * as vscode from 'vscode';

import { Controller } from '../controller';
import { describePresence } from '../core/presence';
import { Candidate, pickAccount } from '../core/policy';
import { AccountView } from '../core/types';
import { oneLine, shortLabel } from './format';
import { signInAgain } from './reauth';

interface Item extends vscode.QuickPickItem {
  accountId?: string;
  action?: 'add' | 'capture' | 'sync-setup' | 'sync-pull' | 'doctor' | 'failover';
}

/**
 * The switcher. Every account carries its own figures, so the choice is made in
 * the list rather than by opening something else first, and the account the
 * policy would pick is marked so the recommendation is visible without
 * auto-failover being on.
 */
export async function showAccountSwitcher(claudeMultiSession: Controller): Promise<void> {
  const quickPick = vscode.window.createQuickPick<Item>();
  quickPick.title = 'Claude accounts';
  quickPick.placeholder = 'Choose an account to use';
  quickPick.matchOnDescription = true;
  quickPick.matchOnDetail = true;
  quickPick.ignoreFocusOut = false;

  const refreshButton: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon('refresh'),
    tooltip: 'Refresh usage figures',
  };
  quickPick.buttons = [refreshButton];

  const render = (): void => {
    quickPick.items = buildItems(claudeMultiSession);
  };
  render();

  const subscription = claudeMultiSession.onDidChange(render);

  quickPick.onDidTriggerButton(async (button) => {
    if (button !== refreshButton) return;
    quickPick.busy = true;
    await claudeMultiSession.refresh({ force: true });
    render();
    quickPick.busy = false;
  });

  const chosen = await new Promise<Item | undefined>((resolve) => {
    quickPick.onDidAccept(() => resolve(quickPick.selectedItems[0]));
    quickPick.onDidHide(() => resolve(undefined));
    quickPick.show();
  });

  subscription.dispose();
  quickPick.hide();
  quickPick.dispose();

  if (!chosen) return;

  if (chosen.action) {
    await vscode.commands.executeCommand(commandFor(chosen.action));
    return;
  }

  if (chosen.accountId) {
    // A revoked account cannot be switched to, so choosing one means "get this
    // working again" — take it straight to the sign-in rather than explaining
    // why the click did nothing.
    const profile = claudeMultiSession.store.get(chosen.accountId);
    if (profile?.needsSignIn) {
      await signInAgain(claudeMultiSession, profile);
      return;
    }
    const result = await claudeMultiSession.switchTo(chosen.accountId);
    if (result.ok) {
      void vscode.window.showInformationMessage(result.message);
      return;
    }
    const choice = await vscode.window.showWarningMessage(
      result.message,
      ...(result.revoked ? ['Sign in again'] : []),
    );
    if (choice === 'Sign in again') await signInAgain(claudeMultiSession, profile);
  }
}

function commandFor(action: NonNullable<Item['action']>): string {
  switch (action) {
    case 'add':
      return 'claudeMultiSession.addAccount';
    case 'capture':
      return 'claudeMultiSession.captureCurrent';
    case 'sync-setup':
      return 'claudeMultiSession.syncSetup';
    case 'sync-pull':
      return 'claudeMultiSession.syncPull';
    case 'doctor':
      return 'claudeMultiSession.doctor';
    case 'failover':
      return 'claudeMultiSession.toggleFailover';
  }
}

function buildItems(claudeMultiSession: Controller): Item[] {
  const views = claudeMultiSession.views();
  const settings = claudeMultiSession.settings();
  const now = new Date();

  const candidates: Candidate[] = views.map((view) => ({
    accountId: view.profile.id,
    label: view.profile.label,
    snapshot: view.snapshot,
    needsSignIn: view.profile.needsSignIn,
  }));
  const activeId = views.find((view) => view.isActive)?.profile.id;
  const recommended = pickAccount(candidates, {
    ...settings.policy,
    preferCushion: false,
    excludeAccountIds: activeId ? [activeId] : [],
    now,
  }).chosen?.accountId;

  const items: Item[] = [];
  const ordered = [...views].sort(orderForList);

  for (const view of ordered) {
    const revoked = Boolean(view.profile.needsSignIn);
    items.push({
      label: `${revoked ? '$(key) ' : view.isActive ? '$(check) ' : '$(circle-outline) '}${view.profile.label}`,
      description: revoked
        ? 'sign-in revoked — choose to sign in again'
        : describeRight(view, view.profile.id === recommended),
      detail: revoked
        ? 'Opens Anthropic sign-in with this address filled in'
        : detailFor(view, now),
      accountId: view.profile.id,
    });
  }

  items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
  items.push({
    label: '$(add) Add another account…',
    detail: 'Walks you through signing in to a second Claude account',
    action: 'add',
  });
  items.push({
    label: '$(save) Save the current login',
    detail: 'Store whatever Claude Code is signed in to right now as an account',
    action: 'capture',
  });
  if (settings.sync.enabled) {
    items.push({
      label: '$(cloud-download) Pull accounts from sync',
      detail: settings.sync.repository,
      action: 'sync-pull',
    });
  } else {
    items.push({
      label: '$(cloud) Set up sync across machines…',
      detail: 'Keep these accounts in your own private, encrypted repository',
      action: 'sync-setup',
    });
  }
  items.push({
    label: `$(${settings.failoverEnabled ? 'circle-filled' : 'circle-outline'}) Auto-failover: ${
      settings.failoverEnabled ? 'on' : 'off'
    }`,
    detail: settings.failoverEnabled
      ? 'Switches to the account whose weekly quota expires soonest when this one runs out'
      : 'Turn on to switch automatically when the account in use runs out',
    action: 'failover',
  });
  items.push({ label: '$(stethoscope) Doctor', detail: 'Check what Claude Multi Session can see', action: 'doctor' });

  return items;
}

function orderForList(a: AccountView, b: AccountView): number {
  if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
  const left = a.snapshot?.week.percentLeft ?? -1;
  const right = b.snapshot?.week.percentLeft ?? -1;
  if (left !== right) return right - left;
  return a.profile.label.localeCompare(b.profile.label);
}

function describeRight(view: AccountView, recommended: boolean): string {
  const bits: string[] = [];
  if (view.isActive) bits.push('in use');
  if (recommended) bits.push('recommended next');
  if (view.profile.identity?.plan) bits.push(view.profile.identity.plan);
  if (view.stale && view.snapshot) bits.push('figures stale');
  return bits.join(' · ');
}

function detailFor(view: AccountView, now: Date): string {
  const presence = describePresence(view.presence ?? [], now);
  const base = oneLine(view, now);
  return presence ? `${base} · ${presence}` : `${base}${view.profile.identity?.email ? ` · ${shortLabel(view, 40)}` : ''}`;
}
