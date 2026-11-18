import assert from 'node:assert/strict';
import { test } from 'node:test';
import { config } from '../dist/config.mjs';
import { initial } from '../dist/ledger.mjs';

test('Google PKCE sessions only synchronize the ledger of the expected account', async () => {
  config.supabaseKey = 'sb_publishable_test';
  const records = new Map();
  const request = result => {
    const pending = { result };
    queueMicrotask(() => pending.onsuccess());
    return pending;
  };
  globalThis.indexedDB = {
    open: () => request({
      transaction() {
        return {
          objectStore() {
            return {
              get: key => request(records.get(key)),
              put: (value, key) => {
                records.set(key, value);
                queueMicrotask(() => this.oncomplete());
              },
            };
          },
        };
      },
    }),
  };
  globalThis.history = { replaceState() {} };
  globalThis.sessionStorage = { getItem: () => 'pkce-verifier', removeItem() {} };
  const sessionTokens = { first: 'token-first', second: 'token-second' };
  const ledgers = {
    first: { ...initial(), accounts: [{ id: 'cash', name: 'Cash pribadi', opening: 10000, type: 'cash', savings: false }] },
    second: initial(),
  };
  let reads = 0;
  globalThis.fetch = async (target, options) => {
    const url = new URL(target);
    if (url.searchParams.get('grant_type') === 'pkce') {
      const { auth_code: id, code_verifier: verifier } = JSON.parse(options.body);
      assert.equal(verifier, 'pkce-verifier');
      return Response.json({ user: { id }, access_token: sessionTokens[id],
        refresh_token: 'refresh-' + id, expires_in: 3600, provider_token: 'unused-google-token' });
    }
    const accountId = url.searchParams.get('user_id').slice(3);
    assert.equal(options.headers.Authorization, 'Bearer ' + sessionTokens[accountId]);
    reads++;
    return Response.json([{ revision: 0, state: ledgers[accountId] }]);
  };
  const { finishLogin, sync } = await import('../dist/storage.mjs');
  const base = { base: initial(), state: initial() };
  globalThis.location = new URL('https://arus.example/?code=first');
  const first = await finishLogin();
  assert.equal(first.user.id, 'first');
  assert.equal(first.provider_token, undefined);
  assert.deepEqual((await sync('first', base)).state, ledgers.first);
  globalThis.location = new URL('https://arus.example/?code=second');
  const second = await finishLogin();
  assert.equal(second.user.id, 'second');
  assert.deepEqual((await sync('second', base)).state, ledgers.second);
  await assert.rejects(sync('first', base), /Akun aktif telah berubah/);
  assert.equal(reads, 2);
});
