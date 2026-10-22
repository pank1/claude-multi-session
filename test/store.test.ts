import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

import { ProfileStore } from '../src/core/profiles';
import { StoredCredentials } from '../src/core/types';

function credentials(seed: string): StoredCredentials {
  return {
    claudeAiOauth: {
      accessToken: `access-${seed}`,
      refreshToken: `refresh-${seed}`,
      expiresAt: Date.now() + 3_600_000,
    },
  };
}

async function freshStore(): Promise<{ store: ProfileStore; dir: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cms-store-'));
  const store = new ProfileStore({ ...process.env, CLAUDE_MULTI_SESSION_DIR: dir });
  await store.load();
  return { store, dir };
}

test('a stand-in label is replaced once the identity is known', async () => {
  const { store } = await freshStore();
  const profile = await store.add({ label: 'Account 1', credentials: credentials('a') });
  await store.update(profile.id, { identity: { email: 'mike@lv.group' } });

  const renamed = await store.adoptIdentityLabels();

  assert.deepEqual(renamed, ['mike@lv.group']);
  assert.equal(store.get(profile.id)?.label, 'mike@lv.group');
});

test('this runs for an account that already had its identity', async () => {
  // The identity lookup only fires for accounts with no identity, so this is
  // the only path that can ever fix one that was named and identified
  // separately — the case that left the account in daily use as "Account 1".
  const { store } = await freshStore();
  const profile = await store.add({
    label: 'Account 1',
    credentials: credentials('b'),
    identity: { email: 'already@known.com' },
  });

  await store.adoptIdentityLabels();

  assert.equal(store.get(profile.id)?.label, 'already@known.com');
});

test('a name someone chose is left alone', async () => {
  const { store } = await freshStore();
  const profile = await store.add({ label: 'Work billing', credentials: credentials('c') });
  await store.update(profile.id, { identity: { email: 'work@example.com' } });

  assert.deepEqual(await store.adoptIdentityLabels(), []);
  assert.equal(store.get(profile.id)?.label, 'Work billing');
});

test('an account with no identity keeps its stand-in name', async () => {
  const { store } = await freshStore();
  const profile = await store.add({ label: 'Account 2', credentials: credentials('d') });

  assert.deepEqual(await store.adoptIdentityLabels(), []);
  assert.equal(store.get(profile.id)?.label, 'Account 2');
});

test('the rename survives a reload from disk', async () => {
  const { store, dir } = await freshStore();
  const profile = await store.add({
    label: 'Account 1',
    credentials: credentials('e'),
    identity: { email: 'persisted@example.com' },
  });
  await store.adoptIdentityLabels();

  const reopened = new ProfileStore({ ...process.env, CLAUDE_MULTI_SESSION_DIR: dir });
  await reopened.load();
  assert.equal(reopened.get(profile.id)?.label, 'persisted@example.com');
});

test('two accounts cannot end up with the same name', async () => {
  const { store } = await freshStore();
  const first = await store.add({ label: 'same@example.com', credentials: credentials('f') });
  const second = await store.add({ label: 'Account 2', credentials: credentials('g') });
  await store.update(second.id, { identity: { email: 'same@example.com' } });

  await store.adoptIdentityLabels();

  assert.equal(store.get(first.id)?.label, 'same@example.com');
  assert.notEqual(store.get(second.id)?.label, 'same@example.com');
});
