import { config } from './config.mjs';
import { categories, initial, today, types, validate } from './ledger.mjs';
import { cloudReady, currentSession, finishLogin, hasChanges, load, login, logout, merge, requireAccount, save, sync, telegram } from './storage.mjs';
import { backup, csv, download, parseBackup, xlsx } from './exports.mjs';
import { accountsPage, categoriesPage, dashboard, esc, icon, monthLabel, option, periodControl, table } from './views.mjs';
import { accountForm, categoryForm, dialog, groupForm, modal, transactionForm } from './forms.mjs';
import { createDriveActions } from './drive.mjs';

const $ = selector => document.querySelector(selector);
const pages = { ringkasan: ['Ringkasan', 'dashboard'], transaksi: ['Transaksi', 'transactions'],
  rekening: ['Rekening', 'accounts'], kategori: ['Kategori', 'categories'], pengaturan: ['Pengaturan', 'settings'] };
const chart = { daily: false, income: true, expense: true, group: '' };
let filters = {};
let month = today().slice(0, 7);
let session;
let record;
let state;
let syncError;
let connectedBot;
let syncing = false;
let toastTimer;
let queryTimer;
let currentPage = 'ringkasan';
let queue = Promise.resolve();
let openingSession = true;
let signInError;
const authChanges = typeof BroadcastChannel === 'function' ? new BroadcastChannel('arus:auth-changes') : null;
authChanges?.addEventListener('message', () => location.reload());

function notify(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').classList.add('shown');
  toastTimer = setTimeout(() => $('#toast').classList.remove('shown'), 4200);
}
const monthList = () => state.transactions.filter(tx => tx.date.startsWith(month));
const scope = () => 'cloud:' + session.user.id;
function serialized(task, key = scope()) {
  const result = queue.then(() => navigator.locks ? navigator.locks.request('arus:' + key, task) : task());
  queue = result.catch(() => {});
  return result;
}
function refreshStatus() {
  if (!session) {
    $('#google-login').disabled = openingSession || !cloudReady || !navigator.onLine;
    $('#sign-in-status').textContent = openingSession ? 'Memeriksa sesi…' :
      signInError || (!cloudReady ? 'Login belum tersedia. Lengkapi konfigurasi Supabase di dist/config.mjs.' :
        !navigator.onLine ? 'Sambungkan internet untuk masuk.' : '');
    return;
  }
  const pending = record && hasChanges(record);
  const label = syncing ? 'Menyinkronkan…' : syncError ? 'Sinkronisasi perlu diperiksa' :
      !navigator.onLine ? (pending ? 'Offline · menunggu sinkronisasi' : 'Offline') :
      pending ? 'Menunggu sinkronisasi' : 'Tersinkron';
  const content = `<i class="${syncError || !navigator.onLine ? 'warning' : ''}"></i>${label}`;
  $('#sync-status').innerHTML = content;
  $('#mobile-sync-status').innerHTML = content;
  $('#mobile-sync-status').hidden = false;
}
async function synchronize(strategy) {
  if (strategy && (!navigator.onLine || syncing)) throw new Error('Tunggu hingga aplikasi online dan sinkronisasi selesai.');
  if (!session || !navigator.onLine || syncing || (syncError?.conflict && !strategy)) return;
  const userId = session.user.id;
  const key = scope();
  syncing = true;
  refreshStatus();
  try {
    await serialized(async () => {
      if (session?.user.id !== userId) return;
      const next = await sync(userId, (await load(key)) || record, strategy);
      await save(key, next);
      record = next;
      state = next.state;
      syncError = null;
    }, key);
  } catch (error) {
    syncError = error;
    if (strategy) throw error;
  } finally {
    syncing = false;
    if (session?.user.id === userId) {
      if (dialog.open) refreshStatus();
      else render();
    }
  }
}
async function commit(change, message) {
  if (!session) throw new Error('Masuk dengan Google untuk menyimpan data.');
  const userId = session.user.id;
  const key = scope();
  const before = state;
  const draft = structuredClone(before);
  change(draft);
  validate(draft);
  await serialized(async () => {
    await requireAccount(userId);
    const latest = (await load(key)) || record;
    const updated = merge(before, draft, latest.state);
    const next = { ...latest, state: updated };
    await save(key, next);
    state = updated;
    record = next;
  }, key);
  render();
  notify(message);
  void synchronize();
}
const lookup = (items, key) => items.find(item => item.id === key);
function transactions() {
  const categoryNames = new Map(categories(state).map(item => [item.id, item.name + ' ' + item.group.name]));
  const accountNames = new Map(state.accounts.map(item => [item.id, item.name]));
  const search = filters.query?.toLocaleLowerCase('id') || '';
  return (filters.all ? state.transactions : monthList()).filter(tx =>
    (!filters.type || (filters.type === 'salary' ? tx.salary && tx.type !== 'transfer'
      : filters.type === 'cashflow' ? tx.type !== 'transfer' : filters.type === tx.type)) &&
    (!filters.account || tx.account === filters.account || tx.to === filters.account) &&
    (!filters.category || tx.category === filters.category) &&
    (!filters.start || (+tx.date.slice(-2) >= filters.start && +tx.date.slice(-2) <= filters.end)) &&
    (!search || [tx.note, accountNames.get(tx.account), accountNames.get(tx.to), categoryNames.get(tx.category), tx.amount].join(' ').toLocaleLowerCase('id').includes(search)));
}
function transactionPage() {
  return `<div class="page-intro"><div><h1>Transaksi</h1><p>Lihat riwayat pemasukan, pengeluaran, dan transfer.</p></div>${periodControl(month, true, filters.all)}</div>
    <section class="card"><div class="filters">
    <label>Cari<input id="query" type="search" placeholder="Catatan, rekening, nominal…" value="${esc(filters.query)}"></label>
    <label>Jenis<select id="type-filter">${option('', 'Semua jenis', filters.type)}${option('cashflow', 'Pemasukan dan pengeluaran', filters.type)}${Object.entries(types).map(([key, label]) => option(key, label, filters.type)).join('')}${option('salary', 'Gaji dan dari gaji', filters.type)}</select></label>
    <label>Rekening<select id="account-filter">${option('', 'Semua rekening', filters.account)}${state.accounts.map(account => option(account.id, account.name, filters.account)).join('')}</select></label>
    <label>Kategori<select id="category-filter">${option('', 'Semua kategori', filters.category)}${categories(state).map(item => option(item.id, item.group.name + ' · ' + item.name, filters.category)).join('')}</select></label>
    ${filters.start ? `<button class="secondary small" data-action="clear-range">Tanggal ${filters.start}–${filters.end} ×</button>` : ''}</div>
    <div class="list-toolbar"><span id="result-count"></span><div class="inline"><button class="secondary small" data-action="csv">${icon('download', 15)} CSV</button><button class="secondary small" data-action="xlsx">${icon('download', 15)} Excel</button></div></div>
    <div id="transaction-results"></div></section>`;
}
function renderResults() {
  const list = transactions();
  $('#result-count').textContent = list.length + ' transaksi';
  $('#transaction-results').innerHTML = table(state, list);
}
function integrationCard(title, body, actions, symbol) {
  return `<section class="card settings-card"><div class="mini-icon">${icon(symbol, 19)}</div><div><h2>${title}</h2><p>${body}</p><div class="inline">${actions}</div></div></section>`;
}
function settingsPage() {
  const button = (action, label) => `<button class="secondary small" data-action="${action}">${label}</button>`;
  const drive = !!config.googleClientId;
  const bot = config.telegramUsername;
  return `<div class="page-intro"><div><h1>Pengaturan</h1><p>Kelola penyimpanan, backup, dan integrasi.</p></div></div><div class="settings-grid">
    ${integrationCard('Penyimpanan dan akun', `Masuk sebagai ${esc(session.user.email)}.`,
      button('sync', 'Sinkronkan') + button('logout', 'Keluar'), 'settings')}
    ${syncError ? integrationCard('Sinkronisasi perlu diperiksa', esc(syncError.message), syncError.conflict ?
      button('backup', 'Backup dulu') + button('resolve-local', 'Utamakan perubahan lokal') + button('resolve-remote', 'Muat versi cloud') :
      syncError.authRequired ? button('login', 'Masuk ulang dengan Google') : button('sync', 'Coba lagi'), 'transactions') : ''}
    ${integrationCard('Backup file', 'Unduh data keseluruhan dalam format JSON atau pulihkan dari file backup Arus.', button('backup', 'Unduh JSON') + button('import', 'Pulihkan dari file'), 'download')}
    ${integrationCard('Google Drive', drive ? 'Simpan atau pulihkan backup dari Google Drive dengan memberi izin akses.' :
      'Backup Drive menunggu Google OAuth Client ID.', drive ? button('drive-save', 'Simpan ke Drive') + button('drive-restore', 'Pulihkan dari Drive') : '', 'savings')}
    ${integrationCard('Telegram', connectedBot ? 'Bot terhubung. Kirim pesan seperti makan 25000 cash, lalu konfirmasi.' :
      bot ? 'Hubungkan bot untuk mencatat pengeluaran dari percakapan privat.' : 'Integrasi menunggu konfigurasi bot Telegram.',
    bot ? (connectedBot ? button('telegram-unlink', 'Putuskan tautan') : button('telegram-link', 'Hubungkan Telegram')) : '', 'telegram')}
    </div><p class="credits">Katalog logo <a href="https://github.com/hafidznoor/idn-finlogos" target="_blank" rel="noopener noreferrer">idn-finlogos</a> dikurasi oleh Hafidz Noor Fauzi, digunakan tanpa modifikasi dengan lisensi <a href="https://creativecommons.org/licenses/by-nc/4.0/" target="_blank" rel="noopener noreferrer">CC BY-NC 4.0</a>. Logo BCA merupakan merek terdaftar milik PT Bank Central Asia Tbk. Merek lainnya tetap milik pemilik masing-masing.</p>`;
}
function render() {
  $('#authenticated-app').hidden = !session;
  $('#sign-in').hidden = !!session;
  if (!session) {
    $('#main').replaceChildren();
    $('#profile').replaceChildren();
    refreshStatus();
    return;
  }
  const hash = location.hash.slice(1);
  currentPage = Object.hasOwn(pages, hash) ? hash : 'ringkasan';
  $('#nav').innerHTML = Object.entries(pages).map(([route, [label, symbol]]) =>
    `<a href="#${route}" ${route === currentPage ? 'aria-current="page"' : ''}>${icon(symbol)}<span>${label}</span></a>`).join('');
  $('#breadcrumb').innerHTML = `<span>Arus</span><i>/</i><strong>${pages[currentPage][0]}</strong>`;
  $('#profile').innerHTML = `<span class="avatar">${esc((session.user.email || 'P').slice(0, 1).toUpperCase())}</span><span><strong>Akun saya</strong><small>Akun Google</small></span><span aria-hidden="true">›</span>`;
  const views = { ringkasan: () => dashboard(state, monthList(), month, chart), transaksi: transactionPage,
    rekening: () => accountsPage(state), kategori: () => categoriesPage(state), pengaturan: settingsPage };
  $('#main').innerHTML = views[currentPage]();
  if (currentPage === 'transaksi') renderResults();
  refreshStatus();
}
function route(page) {
  if (location.hash === '#' + page) render();
  else location.hash = page;
}
function showTransactions(next = {}) {
  clearTimeout(queryTimer);
  filters = next;
  route('transaksi');
}
window.addEventListener('hashchange', () => {
  render();
  if (session) $('#main').focus({ preventScroll: true });
  window.scrollTo(0, 0);
  if (currentPage === 'pengaturan') void refreshTelegram();
});
dialog.addEventListener('close', () => { if (currentPage === 'pengaturan') render(); });

function restorePreview(next) {
  modal('Pulihkan backup', `<p>Backup berisi <strong>${next.accounts.length} rekening</strong>, <strong>${next.groups.length} kelompok</strong>, dan <strong>${next.transactions.length} transaksi</strong>.</p><p>Pemulihan akan mengganti data akun aktif dan perangkat lain yang tersinkron. Unduh backup yang sekarang jika masih diperlukan.</p>`, () =>
    commit(draft => {
      for (const key of ['accounts', 'groups', 'transactions']) draft[key] = next[key];
    }, 'Backup dipulihkan.'), 'Ganti data dan pulihkan');
}
const backupName = () => 'arus-backup-' + today() + '.json';
$('#file-input').addEventListener('change', async event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    if (file.size > 20 * 1024 * 1024) throw new Error('Ukuran file melebihi 20 MB.');
    restorePreview(parseBackup(await file.text()));
  } catch (error) { notify(error.message); }
});
const drive = createDriveActions(config, () => ({ name: backupName(), snapshot: backup(state) }), restorePreview, notify);
async function refreshTelegram() {
  if (!config.telegramUsername || !session || !navigator.onLine) return;
  const userId = session.user.id;
  try {
    const result = await telegram(userId, 'status');
    if (session?.user.id !== userId) return;
    connectedBot = result.connected;
    if (currentPage === 'pengaturan' && !dialog.open) render();
  } catch { connectedBot = undefined; }
}
async function linkTelegram() {
  if (!/^[a-zA-Z0-9_]{5,32}$/.test(config.telegramUsername)) throw new Error('Username bot Telegram tidak valid.');
  const userId = session.user.id;
  await synchronize();
  const result = await telegram(userId, 'link');
  if (session?.user.id !== userId) return;
  const url = 'https://t.me/' + config.telegramUsername + '?start=' + encodeURIComponent(result.code);
  modal('Hubungkan Telegram', `<p>Buka Telegram dan tekan <strong>Start</strong>. Tautan berlaku 10 menit dan hanya bisa digunakan sekali.</p><a class="primary direct" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Buka bot Telegram ${icon('arrow', 16)}</a>`, null);
}
function chartUpdate(button, update, selector) {
  update();
  render();
  $(selector || '[data-action="' + button.dataset.action + '"][data-id="' + button.dataset.id + '"]')?.focus();
}
function editTransaction(tx) {
  if (!state.accounts.length) {
    notify('Tambahkan rekening sebelum mencatat transaksi.');
    return accountForm(undefined, commit);
  }
  transactionForm(state, tx, commit);
}
const handlers = {
  close: () => dialog.close(),
  profile: () => route('pengaturan'),
  settings: () => route('pengaturan'),
  'add-transaction': () => editTransaction(),
  'edit-transaction': button => editTransaction(lookup(state.transactions, button.dataset.id)),
  'remove-transaction': button => modal('Hapus transaksi?', '<p>Saldo dan laporan akan dihitung ulang setelah transaksi dihapus.</p>', () =>
    commit(draft => { draft.transactions = draft.transactions.filter(tx => tx.id !== button.dataset.id); }, 'Transaksi dihapus.'), 'Hapus transaksi'),
  'add-account': () => accountForm(undefined, commit),
  'edit-account': button => accountForm(lookup(state.accounts, button.dataset.id), commit),
  'add-group': () => groupForm(undefined, commit),
  'edit-group': button => groupForm(lookup(state.groups, button.dataset.id), commit),
  'add-category': button => categoryForm(lookup(state.groups, button.dataset.group), undefined, commit),
  'edit-category': button => {
    const group = lookup(state.groups, button.dataset.group);
    if (group) categoryForm(group, lookup(group.categories, button.dataset.id), commit);
  },
  'all-transactions': () => showTransactions(),
  metric: button => showTransactions({ type: button.dataset.id }),
  'category-transactions': button => showTransactions({ category: button.dataset.id }),
  'account-transactions': button => showTransactions({ account: button.dataset.id, all: true }),
  'clear-range': () => { delete filters.start; delete filters.end; render(); },
  'chart-range': button => showTransactions({ start: Number(button.dataset.start), end: Number(button.dataset.end),
    type: chart.income === chart.expense ? 'cashflow' : chart.income ? 'income' : 'expense' }),
  series: button => chartUpdate(button, () => {
    const key = button.dataset.id;
    if ((chart.income && chart.expense) || !chart[key]) chart[key] = !chart[key];
  }),
  granularity: button => chartUpdate(button, () => { chart.daily = button.dataset.id === 'day'; }),
  group: button => chartUpdate(button, () => { chart.group = button.dataset.id || ''; }, '.breakdown [data-action="group"]'),
  csv: () => download(csv(state, transactions()), 'arus-transaksi-' + (filters.all ? 'semua' : month) + '.csv', 'text/csv;charset=utf-8'),
  xlsx: () => download(xlsx(state, transactions(), filters.all ? 'Semua periode' : monthLabel(month)),
    'arus-transaksi-' + (filters.all ? 'semua' : month) + '.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
  backup: () => download(backup(state), backupName(), 'application/json'),
  import: () => $('#file-input').click(),
  'drive-save': drive.save,
  'drive-restore': drive.restore,
  login,
  sync: async () => { await synchronize(); if (!syncError && navigator.onLine) notify('Sinkronisasi selesai.'); },
  'resolve-local': () => modal('Utamakan perubahan lokal?', '<p>Perubahan lokal akan dipakai jika data yang sama juga diedit di perangkat lain.</p>', () => synchronize('local'), 'Gunakan perubahan lokal'),
  'resolve-remote': () => modal('Muat versi cloud?', '<p>Perubahan lokal yang belum disinkronkan akan dibuang. Unduh backup dulu jika masih diperlukan.</p>', () => synchronize('remote'), 'Muat versi cloud'),
  logout: () => {
    const userId = session.user.id;
    const key = scope();
    if (record && hasChanges(record)) throw new Error('Sinkronkan dulu sebelum keluar. Perubahan lokal masih menunggu.');
    modal('Keluar dari akun?', '<p>Salinan cloud di perangkat ini akan dibersihkan.</p>', async () => {
      await serialized(async () => {
        if (hasChanges((await load(key)) || record)) throw new Error('Masih ada perubahan yang menunggu sinkronisasi.');
        await logout(userId);
        session = null;
        state = null;
        record = null;
        syncError = null;
        authChanges?.postMessage('logout');
      }, key);
      history.replaceState(null, '', location.pathname);
      render();
      notify('Anda sudah keluar.');
    }, 'Keluar');
  },
  'telegram-link': linkTelegram,
  'telegram-unlink': async () => {
    await telegram(session.user.id, 'unlink');
    connectedBot = false;
    render();
    notify('Tautan Telegram diputus.');
  },
};
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button || !Object.hasOwn(handlers, button.dataset.action)) return;
  if (!session && button.dataset.action !== 'login') return;
  try { await handlers[button.dataset.action](button); }
  catch (error) { notify(error.message); }
});
document.addEventListener('change', event => {
  const field = event.target;
  const keys = { 'type-filter': 'type', 'account-filter': 'account', 'category-filter': 'category' };
  if (field.id === 'month' && /^\d{4}-\d\d$/.test(field.value)) {
    month = field.value;
    filters.all = false;
    delete filters.start;
    delete filters.end;
    render();
    $('#month')?.focus();
  } else if (field.id === 'all-time') {
    filters.all = field.checked;
    delete filters.start;
    delete filters.end;
    render();
    $('#all-time')?.focus();
  } else if (Object.hasOwn(keys, field.id)) {
    filters[keys[field.id]] = field.value;
    renderResults();
  }
});
document.addEventListener('input', event => {
  if (event.target.id !== 'query') return;
  filters.query = event.target.value;
  clearTimeout(queryTimer);
  queryTimer = setTimeout(() => { if (currentPage === 'transaksi') renderResults(); }, 100);
});
document.addEventListener('error', event => {
  const image = event.target;
  if (!image.dataset?.logo) return;
  image.hidden = true;
  image.nextElementSibling.hidden = false;
}, true);
window.addEventListener('online', () => { refreshStatus(); void synchronize(); });
window.addEventListener('offline', refreshStatus);
window.addEventListener('focus', () => {
  void synchronize();
  if (currentPage === 'pengaturan') void refreshTelegram();
});
setInterval(() => { if (document.visibilityState === 'visible' && !dialog.open) void synchronize(); }, 45000);
try {
  let loggedIn;
  try { loggedIn = await finishLogin(); }
  catch (error) { signInError = error.message; }
  const active = loggedIn || (cloudReady ? await currentSession() : null);
  if (active) {
    const saved = await load('cloud:' + active.user.id);
    record = saved || { base: initial(), state: initial() };
    state = record.state;
    session = active;
  }
  if (loggedIn) authChanges?.postMessage('login');
} catch (error) { signInError = 'Penyimpanan browser tidak tersedia. ' + error.message; }
openingSession = false;
render();
void synchronize();
if (currentPage === 'pengaturan') void refreshTelegram();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
