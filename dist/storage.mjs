import { installCategoryCatalog } from './category-catalog.mjs';
import { config } from './config.mjs';
import { initial, validate } from './ledger.mjs';

const requestResult = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
let dbPromise;
function database() {
  dbPromise ||= (async () => {
    const request = indexedDB.open('arus-money-tracker', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('data');
    return requestResult(request);
  })();
  return dbPromise;
}
export async function load(key) {
  const db = await database();
  return requestResult(db.transaction('data').objectStore('data').get(key));
}
export async function save(key, value) {
  const db = await database();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction('data', 'readwrite');
    transaction.objectStore('data').put(value, key);
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error);
  });
}

export const cloudReady = !!(config.supabaseUrl && config.supabaseKey);
const sessionKey = 'arus-session';
const authLock = task => globalThis.navigator?.locks ? navigator.locks.request('arus:auth', task) : task();
const redirect = () => location.origin + location.pathname;
const serverUrl = path => config.supabaseUrl.replace(/\/$/, '') + path;
async function api(path, { token, body, method = 'GET', prefer } = {}) {
  const response = await fetch(serverUrl(path), {
    method,
    headers: {
      apikey: config.supabaseKey,
      ...(token && { Authorization: 'Bearer ' + token }),
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
      ...(prefer && { Prefer: prefer }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(result?.msg || result?.message || result?.error_description || 'Layanan Arus tidak dapat diakses.');
    error.status = response.status;
    throw error;
  }
  return result;
}
function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
export async function login() {
  if (!cloudReady) throw new Error('Konfigurasi Supabase belum lengkap.');
  if (!navigator.onLine) throw new Error('Sambungkan internet untuk masuk dengan Google.');
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  sessionStorage.setItem('arus-oauth-verifier', verifier);
  const params = new URLSearchParams({ provider: 'google', redirect_to: redirect(), code_challenge: challenge,
    code_challenge_method: 's256', prompt: 'select_account' });
  location.assign(serverUrl('/auth/v1/authorize?' + params));
}
export const currentSession = () => load(sessionKey);
function sessionRecord(session) {
  if (!session?.user?.id || !session.access_token || !session.refresh_token) throw new Error('Sesi Google tidak valid.');
  return { user: { id: session.user.id, email: session.user.email }, access_token: session.access_token,
    refresh_token: session.refresh_token, expires_at: session.expires_at ?? Math.floor(Date.now() / 1000) + session.expires_in };
}
export async function finishLogin() {
  const params = new URLSearchParams(location.search);
  if (!cloudReady || (!params.has('code') && !params.has('error'))) return;
  history.replaceState(null, '', location.pathname + (params.has('code') ? '' : location.hash));
  const verifier = sessionStorage.getItem('arus-oauth-verifier');
  sessionStorage.removeItem('arus-oauth-verifier');
  if (!verifier || params.has('error')) throw new Error('Login Google tidak selesai. Coba masuk lagi.');
  return authLock(async () => {
    const session = sessionRecord(await api('/auth/v1/token?grant_type=pkce', {
      method: 'POST', body: { auth_code: params.get('code'), code_verifier: verifier },
    }));
    await save(sessionKey, session);
    return session;
  });
}
export async function requireAccount(expectedId) {
  const session = await currentSession();
  if (!session || session.user.id !== expectedId) throw new Error('Akun aktif telah berubah. Muat ulang halaman.');
  return session;
}
function freshSession(expectedId) {
  return authLock(async () => {
    const session = await requireAccount(expectedId);
    if (session.expires_at * 1000 > Date.now() + 60000) return session;
    try {
      const next = sessionRecord(await api('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST', body: { refresh_token: session.refresh_token },
      }));
      if (next.user.id !== expectedId) throw new Error('Sesi baru tidak cocok dengan akun aktif.');
      await save(sessionKey, next);
      return next;
    } catch (error) {
      if (error.status === 400 || error.status === 401) {
        const expired = new Error('Sesi Google berakhir. Masuk lagi untuk melanjutkan sinkronisasi.');
        expired.authRequired = true;
        throw expired;
      }
      throw error;
    }
  });
}
export function logout(expectedId) {
  return authLock(async () => {
    const session = await requireAccount(expectedId);
    if (navigator.onLine) await api('/auth/v1/logout?scope=local', { method: 'POST', token: session.access_token }).catch(() => {});
    await save(sessionKey, null);
    await save('cloud:' + expectedId, null);
  });
}

export const collections = ['accounts', 'groups', 'transactions', 'obligations'];
function canonical(value) {
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}
const same = (left, right) => canonical(left) === canonical(right);
export const hasChanges = record => !same(record.state, record.base);

function mergeConflict() {
  const error = new Error('Perubahan pada data yang sama ditemukan di perangkat lain. Buka Pengaturan untuk menyelesaikannya.');
  error.conflict = true;
  return error;
}
export function merge(base, local, remote, preferLocal = false) {
  const merged = {};
  for (const collection of collections) {
    const before = new Map((base[collection] ?? []).map(item => [item.id, item]));
    const here = new Map((local[collection] ?? []).map(item => [item.id, item]));
    const there = new Map((remote[collection] ?? []).map(item => [item.id, item]));
    if (collection === 'transactions') {
      const adjustedLocally = new Set([...here.values()].filter(tx => tx.type === 'adjustment' && !before.has(tx.id) && !there.has(tx.id))
        .map(tx => tx.account));
      for (const tx of there.values()) {
        if (tx.type !== 'adjustment' || before.has(tx.id) || here.has(tx.id) || !adjustedLocally.has(tx.account)) continue;
        if (!preferLocal) throw mergeConflict();
        there.delete(tx.id);
      }
    }
    for (const key of new Set([...before.keys(), ...here.keys()])) {
      const original = before.get(key);
      const next = here.get(key);
      const latest = there.get(key);
      if (same(original, next)) continue;
      if (!preferLocal && !same(original, latest) && !same(next, latest)) throw mergeConflict();
      if (next) there.set(key, next);
      else there.delete(key);
    }
    merged[collection] = [...there.values()];
  }
  try { return validate(merged); }
  catch {
    const error = new Error('Perubahan dari dua perangkat tidak dapat digabung. Simpan backup lokal sebelum memuat data cloud.');
    error.conflict = true;
    throw error;
  }
}

export async function sync(expectedId, record, strategy) {
  const session = await freshSession(expectedId);
  const token = session.access_token;
  const filter = '?user_id=eq.' + encodeURIComponent(session.user.id);
  const path = '/rest/v1/ledgers';
  for (let attempt = 0; attempt < 5; attempt++) {
    const [row] = await api(path + filter + '&select=revision,state', { token });
    const remote = row ? validate(row.state) : initial();
    const next = installCategoryCatalog(strategy === 'remote' ? remote : merge(record.base, record.state, remote, strategy === 'local'));
    if (row && same(remote, next)) return { state: remote, base: remote };
    const updated = await api(row ? path + filter + '&revision=eq.' + row.revision : path, {
      method: row ? 'PATCH' : 'POST', token,
      prefer: row ? 'return=representation' : 'resolution=ignore-duplicates,return=representation',
      body: row ? { revision: row.revision + 1, state: next } : { user_id: session.user.id, state: next },
    });
    if (updated.length) return { state: next, base: next };
  }
  throw new Error('Data sedang diperbarui dari perangkat lain. Coba sinkronkan lagi.');
}

export async function telegram(expectedId, action) {
  const session = await freshSession(expectedId);
  return api('/functions/v1/telegram', { token: session.access_token, method: 'POST', body: { action } });
}
