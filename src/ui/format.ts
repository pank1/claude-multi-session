import { bindingWindow, nextReset } from '../core/usage';
import { describePresence } from '../core/presence';
import { formatCountdown, formatRelative, msUntil } from '../core/time';
import { AccountView, Severity, WindowUsage } from '../core/types';

/**
 * One convention everywhere: **bars fill as quota is spent**, and the number
 * beside a bar is the same thing the bar shows — used, never left. The status
 * bar is the single exception and says "left" in words, because what you want
 * at a glance is how much you still have.
 */
const FILL: Record<Severity, string> = {
  normal: '🟩',
  warning: '🟨',
  critical: '🟧',
  exhausted: '🟥',
};
const EMPTY = '⬜';

/** Colour from the number itself, so two accounts at 60% always look the same. */
export function colourFor(percentUsed: number): Severity {
  if (percentUsed >= 90) return 'exhausted';
  if (percentUsed >= 75) return 'critical';
  if (percentUsed >= 50) return 'warning';
  return 'normal';
}

/**
 * `🟩🟩⬜⬜⬜⬜⬜⬜` — emoji because a hover is Markdown, where there is no CSS
 * to colour anything with. Anything above zero shows at least one segment, so
 * "barely started" never looks identical to "untouched".
 */
export function colouredBar(percentUsed: number, width = 8): string {
  const safe = Math.min(100, Math.max(0, percentUsed));
  const exact = Math.round((safe / 100) * width);
  const filled = safe > 0 ? Math.max(1, exact) : 0;
  return FILL[colourFor(safe)].repeat(filled) + EMPTY.repeat(Math.max(0, width - filled));
}

/** `🟩🟩⬜⬜⬜⬜⬜⬜ 25% used · 1d 13h` */
export function windowCell(usage: WindowUsage | undefined, now: Date): string {
  if (!usage) return '—';
  if (usage.locked) return `${colouredBar(100)} locked`;
  const used = Math.round(usage.percentUsed);
  const reset = usage.resetsAt ? ` · ${formatCountdown(msUntil(usage.resetsAt, now))}` : '';
  return `${colouredBar(used)} ${used}% used${reset}`;
}

export function severityIcon(severity: Severity): string {
  switch (severity) {
    case 'exhausted':
      return '$(circle-slash)';
    case 'critical':
      return '$(error)';
    case 'warning':
      return '$(warning)';
    default:
      return '$(pulse)';
  }
}

/** Short name for the status bar: the email's local part, or the label. */
export function shortLabel(view: AccountView, max = 16): string {
  const email = view.profile.identity?.email;
  const base = email ? email.split('@')[0]! : view.profile.label;
  return base.length > max ? `${base.slice(0, max - 1)}…` : base;
}

export function sourceMark(view: AccountView): string {
  return view.snapshot?.source === 'estimate' ? '~' : '';
}

/** The single most useful sentence about an account, for lists. */
export function oneLine(view: AccountView, now = new Date()): string {
  if (view.profile.needsSignIn) return 'sign-in revoked — re-add this account';
  const snapshot = view.snapshot;
  if (!snapshot) return view.lastError ?? 'no figures yet';
  const mark = sourceMark(view);
  const reset = nextReset(snapshot, now);
  const countdown = reset ? ` · next reset ${formatCountdown(msUntil(reset, now))}` : '';
  const stale = view.stale ? ` · figures ${formatRelative(snapshot.fetchedAt, now)}` : '';
  return `week ${mark}${Math.round(snapshot.week.percentUsed)}% used · 5-hour ${mark}${Math.round(
    snapshot.session.percentUsed,
  )}% used${countdown}${stale}`;
}

export function statusBarText(
  view: AccountView | undefined,
  options: { showWeekly: boolean; showAccountName: boolean; locked: boolean },
): string {
  if (!view) return '$(account) No Claude account';
  if (view.profile.needsSignIn) return `$(alert) ${shortLabel(view)} · sign in`;
  const snapshot = view.snapshot;
  if (!snapshot) return `$(sync~spin) ${options.showAccountName ? shortLabel(view) : 'Claude'} · reading usage`;

  const binding = bindingWindow(snapshot);
  const mark = sourceMark(view);
  const parts: string[] = [];
  parts.push(view.stale ? '$(history)' : severityIcon(binding.usage.severity));
  if (options.showAccountName) parts.push(shortLabel(view));
  // "left" in words: the bars elsewhere show what is spent, and the two being
  // different numbers for the same window is exactly what confuses people.
  parts.push(`${mark}${Math.round(snapshot.session.percentLeft)}% left`);
  if (options.showWeekly) parts.push(`wk ${mark}${Math.round(snapshot.week.percentLeft)}%`);
  const reset = nextReset(snapshot);
  if (reset) parts.push(`$(clock)${formatCountdown(msUntil(reset))}`);
  if (options.locked) parts.push('$(lock)');
  return parts.join(' ');
}

/**
 * The hover: every account as one row, so comparing them is reading down a
 * column rather than reading prose.
 */
export function tooltipMarkdown(views: AccountView[], now = new Date()): string {
  const lines: string[] = [];

  if (views.length === 0) {
    return [
      '**No Claude account saved**',
      '',
      'Sign in with Claude Code, then run *Claude Multi Session: Save Current Login*.',
    ].join('\n');
  }

  const live = views.filter((view) => !view.profile.needsSignIn);
  const dead = views.filter((view) => view.profile.needsSignIn);

  lines.push('| | Account | Week | 5-hour |');
  lines.push('|---|---|---|---|');

  for (const view of [...live].sort(byWeekHeadroom)) {
    const snapshot = view.snapshot;
    const marker = view.isActive ? '●' : '';
    const name = view.isActive ? `**${view.profile.label}**` : view.profile.label;
    lines.push(
      `| ${marker} | ${name} | ${windowCell(snapshot?.week, now)} | ${windowCell(snapshot?.session, now)} |`,
    );
  }

  for (const view of dead) {
    lines.push(`| ⚠️ | ${view.profile.label} | *sign-in revoked — re-add it* | |`);
  }

  const active = views.find((view) => view.isActive);
  if (active?.snapshot) {
    lines.push('');
    const detail: string[] = [];
    const plan = active.profile.identity?.plan;
    if (plan) detail.push(plan);
    for (const limit of active.snapshot.scoped.filter((entry) => entry.percentUsed > 0)) {
      detail.push(`${limit.label} ${Math.round(limit.percentUsed)}% used`);
    }
    if (active.snapshot.breakdown.length > 0) {
      detail.push(active.snapshot.breakdown.map((row) => `${row.label} ${row.percent}%`).join(', '));
    }
    if (detail.length > 0) lines.push(detail.join(' · '));

    const presence = describePresence(active.presence ?? [], now);
    if (presence) lines.push(`Also ${presence}.`);

    lines.push(
      active.snapshot.source === 'estimate'
        ? `_Estimated from local logs — Anthropic's figures were unavailable ${formatRelative(active.snapshot.fetchedAt, now)}._`
        : `_Figures from ${formatRelative(active.snapshot.fetchedAt, now)}. Bars show quota spent._`,
    );
  }

  if (dead.length > 0) {
    lines.push('');
    lines.push(
      `_${dead.length} account${dead.length === 1 ? ' was' : 's were'} signed out of Claude Code, which revokes the stored sign-in. Re-add ${
        dead.length === 1 ? 'it' : 'them'
      } without using Logout._`,
    );
  }

  lines.push('');
  lines.push(
    '[Switch account](command:claudeMultiSession.switch) · [Add account](command:claudeMultiSession.addAccount) · [Refresh](command:claudeMultiSession.refresh)',
  );
  return lines.join('\n');
}

function byWeekHeadroom(a: AccountView, b: AccountView): number {
  if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
  return (a.snapshot?.week.percentUsed ?? 101) - (b.snapshot?.week.percentUsed ?? 101);
}
