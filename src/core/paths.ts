import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Where Claude Code keeps its own configuration. `CLAUDE_CONFIG_DIR` is honoured
 * by the official client, so we honour it too — otherwise a user who has moved
 * their config would see "not signed in" while Claude Code works fine.
 */
export function claudeDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.CLAUDE_CONFIG_DIR?.trim();
  if (override) return path.resolve(expandHome(override));
  return path.join(os.homedir(), '.claude');
}

export function credentialsFile(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(claudeDir(env), '.credentials.json');
}

export function claudeProjectsDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(claudeDir(env), 'projects');
}

export function claudeIdeDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(claudeDir(env), 'ide');
}

/** Claude Multi Session's own directory. Never inside `.claude`, so uninstalling is clean. */
export function claudeMultiSessionDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.CLAUDE_MULTI_SESSION_DIR?.trim();
  if (override) return path.resolve(expandHome(override));
  return path.join(os.homedir(), '.claude-multi-session');
}

export const files = {
  profiles: (env?: NodeJS.ProcessEnv) => path.join(claudeMultiSessionDir(env), 'profiles.json'),
  state: (env?: NodeJS.ProcessEnv) => path.join(claudeMultiSessionDir(env), 'state.json'),
  snapshots: (env?: NodeJS.ProcessEnv) => path.join(claudeMultiSessionDir(env), 'snapshots.json'),
  backups: (env?: NodeJS.ProcessEnv) => path.join(claudeMultiSessionDir(env), 'backups'),
  syncRepo: (env?: NodeJS.ProcessEnv) => path.join(claudeMultiSessionDir(env), 'sync'),
  bundle: (env?: NodeJS.ProcessEnv) => path.join(claudeMultiSessionDir(env), 'sync', 'accounts.cms'),
  presenceDir: (env?: NodeJS.ProcessEnv) => path.join(claudeMultiSessionDir(env), 'sync', 'presence'),
};

function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}
