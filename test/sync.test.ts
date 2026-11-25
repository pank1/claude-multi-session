import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

import { ProfileStore } from '../src/core/profiles';
import { LockedError, SyncManager } from '../src/core/sync';
import { StoredCredentials } from '../src/core/types';

const run = promisify(execFile);

interface Ask {
  purpose: string;
  prompt: boolean;
}

interface Machine {
  sync: SyncManager;
  store: ProfileStore;
  asks: Ask[];
  /** What the stand-in passphrase holder has cached; undefined means locked. */
  held: { value?: string };
  remote: string;
}

function credentials(seed: string): StoredCredentials {
  return {
    claudeAiOauth: {
      accessToken: `access-${seed}`,
      refreshToken: `refresh-${seed}`,
      expiresAt: Date.now() + 3_600_000,
    },
  };
}

/** A bare repository two machines can both point at. */
async function remoteRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cms-remote-'));
  const remote = path.join(dir, 'remote.git');
  await run('git', ['init', '--bare', '-b', 'main', remote]);
  return remote;
}

async function machine(remote: string, account: string): Promise<Machine> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'cms-home-'));
  const env = { ...process.env, CLAUDE_MULTI_SESSION_DIR: home };
  const store = new ProfileStore(env);
  await store.load();
  await store.add({ label: account, credentials: credentials(account) });

  const asks: Ask[] = [];
  const held: { value?: string } = { value: undefined };

  const sync = new SyncManager({
    store,
    env,
    machineLabel: `box-${account}`,
    settings: () => ({
      enabled: true,
      repository: remote,
      branch: 'main',
      autoPush: true,
      pullIntervalMinutes: 15,
    }),
    // Stands in for PassphraseHolder: a cached value answers anything, and
    // without one only a prompting call can produce a passphrase at all.
    getPassphrase: async (purpose, options) => {
      asks.push({ purpose, prompt: options.prompt });
      if (held.value !== undefined) return held.value;
      return options.prompt ? 'typed-at-the-prompt' : undefined;
    },
  });

  return { sync, store, asks, held, remote };
}

test('a locked background push stops, without putting a prompt on screen', async () => {
  const box = await machine(await remoteRepo(), 'one@example.com');

  await assert.rejects(() => box.sync.push('token rotated'), LockedError);

  assert.deepEqual(
    box.asks.map((ask) => ask.prompt),
    [false],
    'background work must never ask — that is the prompt that fired every poll cycle',
  );
});

test('a locked background pull stops the same way', async () => {
  const remote = await remoteRepo();
  const first = await machine(remote, 'one@example.com');
  first.held.value = 'correct horse';
  await first.sync.push('seed the remote');

  const second = await machine(remote, 'two@example.com');
  await assert.rejects(
    () => second.sync.pull({ purpose: 'fetch the newest sign-in for an account' }),
    LockedError,
  );
  assert.equal(second.asks.at(-1)?.prompt, false);
});

test('a push the user asked for still prompts', async () => {
  const box = await machine(await remoteRepo(), 'one@example.com');

  const result = await box.sync.push('manual push', { interactive: true });

  assert.equal(result.pushed, true);
  assert.equal(box.asks.at(-1)?.prompt, true);
});

test('a pull the user asked for still prompts', async () => {
  const remote = await remoteRepo();
  const first = await machine(remote, 'one@example.com');
  first.held.value = 'typed-at-the-prompt';
  await first.sync.push('seed the remote');

  const second = await machine(remote, 'two@example.com');
  const result = await second.sync.pull({ purpose: 'read your synced accounts', interactive: true });

  assert.equal(second.asks.at(-1)?.prompt, true);
  assert.equal(result.added.length, 1);
});

test('an unlocked machine syncs in the background with no prompt at all', async () => {
  const box = await machine(await remoteRepo(), 'one@example.com');
  box.held.value = 'correct horse';

  const result = await box.sync.push('token rotated');

  assert.equal(result.pushed, true);
  assert.deepEqual(
    box.asks.map((ask) => ask.prompt),
    [false],
    'a cached passphrase is enough; the prompt flag stays off',
  );
});

test('a locked background push leaves the remote untouched', async () => {
  const remote = await remoteRepo();
  const box = await machine(remote, 'one@example.com');

  await assert.rejects(() => box.sync.push('token rotated'), LockedError);

  // Nothing was written, so the remote still has no branch at all rather than a
  // commit holding a half-written or unencrypted bundle.
  const { stdout } = await run('git', ['ls-remote', remote]);
  assert.equal(stdout.trim(), '');
});
