import { categoryName, groupName, language, locale, setPreference, t, theme } from './preferences.mjs';
import { config } from './config.mjs';
import { categories, categoryReviewFilter, initial, obligationProgress, today, types, validate } from './ledger.mjs';
import { cloudReady, collections, currentSession, finishLogin, hasChanges, load, login, logout, merge, requireAccount, save, sync, telegram } from './storage.mjs';
import { backup, csv, download, parseBackup, xlsx } from './exports.mjs';
import { accountsPage, categoriesPage, dashboard, esc, icon, monthLabel, obligationsPage, option, periodControl, table } from './views.mjs';
import { accountForm, categoryForm, dialog, groupForm, modal, obligationForm, obligationPaymentForm, transactionForm } from './forms.mjs';
import { createDriveActions } from './drive.mjs';

const $ = selector => document.querySelector(selector);
const pages = { ringkasan: ['Ringkasan', 'dashboard'], transaksi: ['Transaksi', 'transactions'],
  rekening: ['Rekening', 'accounts'], kategori: ['Kategori', 'categories'], tagihan: ['Tagihan', 'bills'], pengaturan: ['Pengaturan', 'settings'] };
const chart = { monthly: false, income: true, expense: true, group: '' };
let filters = {};
let categoryGroup = '';
let manageGroups = false;
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
  $('#toast').textContent = t(message);
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
    $('#sign-in-status').textContent = openingSession ? t('Memeriksa sesi…') :
      (signInError && t(signInError)) || (!cloudReady ? t('Login belum tersedia. Lengkapi konfigurasi Supabase di dist/config.mjs.') :
        !navigator.onLine ? t('Sambungkan internet untuk masuk.') : '');
    return;
  }
  const pending = record && hasChanges(record);
  const label = syncing ? t('Menyinkronkan…') : syncError ? t('Sinkronisasi perlu diperiksa') :
      !navigator.onLine ? (pending ? t('Offline · menunggu sinkronisasi') : 'Offline') :
      pending ? t('Menunggu sinkronisasi') : t('Tersinkron');
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
  const categoryNames = new Map(categories(state).map(item => [item.id, [categoryName(item), item.name, groupName(item.group), item.group.name].join(' ')]));
  const accountNames = new Map(state.accounts.map(item => [item.id, item.name]));
  const search = filters.query?.toLocaleLowerCase(locale()) || '';
  return (filters.all ? state.transactions : monthList()).filter(tx =>
    (!filters.type || (filters.type === 'salary' ? tx.salary && tx.type !== 'transfer'
      : filters.type === 'cashflow' ? tx.type !== 'transfer' : filters.type === tx.type)) &&
    (!filters.account || tx.account === filters.account || tx.to === filters.account) &&
    (!filters.category || (filters.category === categoryReviewFilter ? tx.needsCategory : tx.category === filters.category)) &&
    (!filters.obligation || tx.obligation === filters.obligation) &&
    (!filters.start || (+tx.date.slice(-2) >= filters.start && +tx.date.slice(-2) <= filters.end)) &&
    (!search || [tx.note, accountNames.get(tx.account), accountNames.get(tx.to), categoryNames.get(tx.category), tx.amount].join(' ').toLocaleLowerCase(locale()).includes(search)));
}
function transactionPage() {
  const plan = lookup(state.obligations || [], filters.obligation);
  const reviewCount = state.transactions.filter(tx => tx.needsCategory).length;
  return `<div class="page-intro"><div><h1>${t('Transaksi')}</h1><p>${t('Lihat riwayat pemasukan, pengeluaran, dan transfer.')}</p></div>${periodControl(month, true, filters.all)}</div>
    <section class="card"><div class="filters">
    <label>${t('Cari')}<input id="query" type="search" placeholder="${t('Catatan, rekening, nominal…')}" value="${esc(filters.query)}"></label>
    <label>${t('Jenis')}<select id="type-filter">${option('', t('Semua jenis'), filters.type)}${option('cashflow', t('Pemasukan dan pengeluaran'), filters.type)}${Object.entries(types).map(([key, label]) => option(key, t(label), filters.type)).join('')}${option('salary', t('Gaji dan dari gaji'), filters.type)}</select></label>
    <label>${t('Rekening')}<select id="account-filter">${option('', t('Semua rekening'), filters.account)}${state.accounts.map(account => option(account.id, account.name, filters.account)).join('')}</select></label>
    <label>${t('Kategori')}<select id="category-filter">${option('', t('Semua kategori'), filters.category)}${option(categoryReviewFilter, t('Perlu kategori'), filters.category)}${categories(state).sort((left, right) => categoryName(left).localeCompare(categoryName(right), locale())).map(item => option(item.id, categoryName(item), filters.category)).join('')}</select></label>
    ${filters.start ? `<button class="secondary small" data-action="clear-range">${t('Tanggal {range}', { range: filters.start + '–' + filters.end })} ×</button>` : ''}
    ${plan ? `<button class="secondary small" data-action="clear-obligation">${esc(plan.name)} ×</button>` : ''}</div>
    <div class="list-toolbar"><div class="inline"><span id="result-count" role="status"></span>${reviewCount ? `<button class="secondary small" data-action="review-categories">${t('Perlu kategori')} · ${reviewCount}</button>` : ''}<button class="text-button small" data-action="clear-filters" hidden>${t('Bersihkan filter')}</button></div><div class="inline"><button class="secondary small" data-action="csv">${icon('download', 15)} CSV</button><button class="secondary small" data-action="xlsx">${icon('download', 15)} Excel</button></div></div>
    <div id="transaction-results"></div></section>`;
}
function renderResults() {
  const list = transactions();
  $('#result-count').textContent = t(list.length === 1 ? '1 transaksi' : '{count} transaksi', { count: list.length });
  $('[data-action="clear-filters"]').hidden = !['query', 'type', 'account', 'category', 'start', 'obligation'].some(key => filters[key]);
  $('#transaction-results').innerHTML = table(state, list);
}
function integrationCard(title, body, actions, symbol) {
  return `<section class="card settings-card"><div class="mini-icon">${icon(symbol, 19)}</div><div><h2>${title}</h2><p>${body}</p><div class="inline">${actions}</div></div></section>`;
}
function preferences(context) {
  return `<div class="preference-fields">
    <label>${t('Tema')}<select id="${context}-theme" data-preference="theme">
      ${option('system', t('Sistem'), theme)}${option('dark', t('Gelap'), theme)}${option('light', t('Terang'), theme)}
    </select></label>
    <label>${t('Bahasa')}<select id="${context}-language" data-preference="language">
      ${option('id', 'Bahasa Indonesia', language)}${option('en', 'English', language)}
    </select></label>
  </div>`;
}
function localizeShell() {
  document.documentElement.lang = language;
  document.querySelectorAll('[data-text]').forEach(node => { node.textContent = t(node.dataset.text); });
  $('#nav').setAttribute('aria-label', t('Navigasi utama'));
  $('#profile').setAttribute('aria-label', t('Akun saya'));
  $('[data-action="close"]').setAttribute('aria-label', t('Tutup'));
}
function settingsPage() {
  const button = (action, label) => `<button class="secondary small" data-action="${action}">${t(label)}</button>`;
  const drive = !!config.googleClientId;
  const bot = config.telegramUsername;
  return `<div class="page-intro"><div><h1>${t('Pengaturan')}</h1><p>${t('Kelola penyimpanan, backup, dan integrasi.')}</p></div></div><div class="settings-grid">
    ${integrationCard(t('Tampilan'), t('Atur tema dan bahasa di perangkat ini.'), preferences('settings'), 'appearance')}
    ${integrationCard(t('Penyimpanan dan akun'), t('Masuk sebagai {email}.', { email: esc(session.user.email) }),
      button('sync', 'Sinkronkan') + button('logout', 'Keluar'), 'settings')}
    ${syncError ? integrationCard(t('Sinkronisasi perlu diperiksa'), esc(t(syncError.message)), syncError.conflict ?
      button('backup', 'Backup dulu') + button('resolve-local', 'Utamakan perubahan lokal') + button('resolve-remote', 'Muat versi cloud') :
      syncError.authRequired ? button('login', 'Masuk ulang dengan Google') : button('sync', 'Coba lagi'), 'transactions') : ''}
    ${integrationCard(t('Backup file'), t('Unduh data keseluruhan dalam format JSON atau pulihkan dari file backup Arus.'), button('backup', 'Unduh JSON') + button('import', 'Pulihkan dari file'), 'download')}
    ${integrationCard('Google Drive', drive ? t('Simpan atau pulihkan backup dari Google Drive dengan memberi izin akses.') :
      t('Backup Drive menunggu Google OAuth Client ID.'), drive ? button('drive-save', 'Simpan ke Drive') + button('drive-restore', 'Pulihkan dari Drive') : '', 'savings')}
    ${integrationCard('Telegram', connectedBot ? t('Bot terhubung. Kirim pesan seperti makan 25000 cash, lalu konfirmasi.') :
      bot ? t('Hubungkan bot untuk mencatat pengeluaran dari percakapan privat.') : t('Integrasi menunggu konfigurasi bot Telegram.'),
    bot ? (connectedBot ? button('telegram-unlink', 'Putuskan tautan') : button('telegram-link', 'Hubungkan Telegram')) : '', 'telegram')}
    </div><p class="credits">${t('Katalog logo {catalog} dikurasi oleh Hafidz Noor Fauzi, digunakan tanpa modifikasi dengan lisensi {license}. Logo BCA merupakan merek terdaftar milik PT Bank Central Asia Tbk. Merek lainnya tetap milik pemilik masing-masing.', { catalog: '<a href="https://github.com/hafidznoor/idn-finlogos" target="_blank" rel="noopener noreferrer">idn-finlogos</a>', license: '<a href="https://creativecommons.org/licenses/by-nc/4.0/" target="_blank" rel="noopener noreferrer">CC BY-NC 4.0</a>' })}</p>`;
}
function render() {
  localizeShell();
  $('#authenticated-app').hidden = !session;
  $('#sign-in').hidden = !!session;
  if (!session) {
    $('#sign-in-preferences').innerHTML = preferences('sign-in');
    $('#main').replaceChildren();
    $('#profile').replaceChildren();
    refreshStatus();
    return;
  }
  if (!lookup(state.groups, chart.group)) chart.group = '';
  if (!lookup(state.groups, categoryGroup)) categoryGroup = '';
  const hash = location.hash.slice(1);
  const nextPage = Object.hasOwn(pages, hash) ? hash : 'ringkasan';
  const fieldId = nextPage === currentPage && $('#main').contains(document.activeElement) ? document.activeElement.id : '';
  currentPage = nextPage;
  $('#nav').innerHTML = Object.entries(pages).map(([route, [label, symbol]]) =>
    `<a href="#${route}" aria-label="${t(label)}" title="${t(label)}" ${route === currentPage ? 'aria-current="page"' : ''}>${icon(symbol)}<span>${t(label)}</span></a>`).join('');
  $('#breadcrumb').innerHTML = `<span>Arus</span><i>/</i><strong>${t(pages[currentPage][0])}</strong>`;
  $('#profile').innerHTML = `<span class="avatar">${esc((session.user.email || 'P').slice(0, 1).toUpperCase())}</span><span><strong>${t('Akun saya')}</strong><small>${t('Akun Google')}</small></span><span aria-hidden="true">›</span>`;
  const views = { ringkasan: () => dashboard(state, monthList(), month, chart), transaksi: transactionPage,
    rekening: () => accountsPage(state), kategori: () => categoriesPage(state, categoryGroup, manageGroups),
    tagihan: () => obligationsPage(state), pengaturan: settingsPage };
  $('#main').innerHTML = views[currentPage]();
  if (currentPage === 'transaksi') renderResults();
  if (fieldId) document.getElementById(fieldId)?.focus({ preventScroll: true });
  $('#manage-groups')?.addEventListener('toggle', event => {
    if (event.target.isConnected) manageGroups = event.target.open;
  });
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
  modal(t('Pulihkan backup'), `<p>${t('Backup berisi {accounts}, {groups}, {transactions}, dan {obligations}.', {
    accounts: '<strong>' + t(next.accounts.length === 1 ? '1 rekening' : '{count} rekening', { count: next.accounts.length }) + '</strong>',
    groups: '<strong>' + t(next.groups.length === 1 ? '1 kelompok' : '{count} kelompok', { count: next.groups.length }) + '</strong>',
    transactions: '<strong>' + t(next.transactions.length === 1 ? '1 transaksi' : '{count} transaksi', { count: next.transactions.length }) + '</strong>',
    obligations: '<strong>' + t('{count} jadwal pembayaran', { count: next.obligations.length }) + '</strong>',
  })}</p><p>${t('Pemulihan akan mengganti data akun aktif dan perangkat lain yang tersinkron. Unduh backup yang sekarang jika masih diperlukan.')}</p>`, () =>
    commit(draft => {
      for (const key of collections) draft[key] = next[key];
    }, t('Backup dipulihkan.')), t('Ganti data dan pulihkan'));
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
  modal(t('Hubungkan Telegram'), `<p>${t('Buka Telegram dan tekan {start}. Tautan berlaku 10 menit dan hanya bisa digunakan sekali.', { start: '<strong>Start</strong>' })}</p><a class="primary direct" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${t('Buka bot Telegram')} ${icon('arrow', 16)}</a>`, null);
}
function chartUpdate(button, update, selector) {
  update();
  render();
  $(selector || '[data-action="' + button.dataset.action + '"][data-id="' + button.dataset.id + '"]')?.focus();
}
function editTransaction(tx) {
  if (!state.accounts.length) {
    notify(t('Tambahkan rekening sebelum mencatat transaksi.'));
    return accountForm(undefined, commit);
  }
  transactionForm(state, tx, commit);
}
const handlers = {
  close: () => dialog.close(),
  profile: () => route('pengaturan'),
  'add-transaction': () => editTransaction(),
  'edit-transaction': button => editTransaction(lookup(state.transactions, button.dataset.id)),
  'remove-transaction': button => modal(t('Hapus transaksi?'), `<p>${t('Saldo dan laporan akan dihitung ulang setelah transaksi dihapus.')}</p>`, () =>
    commit(draft => { draft.transactions = draft.transactions.filter(tx => tx.id !== button.dataset.id); }, t('Transaksi dihapus.')), t('Hapus transaksi')),
  'add-obligation': () => obligationForm(undefined, commit),
  'edit-obligation': button => {
    const item = lookup(state.obligations || [], button.dataset.id);
    if (item) obligationForm(item, commit);
  },
  'pay-obligation': button => {
    const item = lookup(state.obligations || [], button.dataset.id);
    if (!item || item.archived) return;
    if (!state.accounts.length) {
      notify('Tambahkan rekening sebelum mencatat transaksi.');
      return accountForm(undefined, commit);
    }
    if (!categories(state).some(category => !category.archived && !category.group.archived)) {
      notify('Tambahkan kategori aktif sebelum mencatat pembayaran.');
      return route('kategori');
    }
    const progress = obligationProgress(item, state.transactions.filter(tx => tx.obligation === item.id));
    if (item.kind === 'loan' ? progress.remaining > 0 : progress.due) obligationPaymentForm(state, item, progress, commit);
  },
  'obligation-history': button => showTransactions({ obligation: button.dataset.id, all: true }),
  'clear-obligation': () => { delete filters.obligation; render(); $('#query')?.focus(); },
  'add-account': () => accountForm(undefined, commit),
  'edit-account': button => accountForm(lookup(state.accounts, button.dataset.id), commit),
  'add-group': () => groupForm(undefined, commit),
  'edit-group': button => groupForm(lookup(state.groups, button.dataset.id), commit),
  'add-category': () => categoryForm(state, null, undefined, commit, categoryGroup),
  'edit-category': button => {
    const group = lookup(state.groups, button.dataset.group);
    if (group) categoryForm(state, group, lookup(group.categories, button.dataset.id), commit);
  },
  'all-transactions': () => showTransactions(),
  metric: button => showTransactions({ type: button.dataset.id }),
  'category-transactions': button => showTransactions({ category: button.dataset.id }),
  'review-categories': () => showTransactions({ category: categoryReviewFilter, all: true }),
  'account-transactions': button => showTransactions({ account: button.dataset.id, all: true }),
  'clear-range': () => { delete filters.start; delete filters.end; render(); $('#query')?.focus(); },
  'clear-filters': () => { clearTimeout(queryTimer); filters = { all: filters.all }; render(); $('#query')?.focus(); },
  'shift-month': button => {
    const date = new Date(month + '-01T00:00:00Z');
    date.setUTCMonth(date.getUTCMonth() + Number(button.dataset.id));
    const year = date.getUTCFullYear();
    if (year >= 1 && year <= 9999) updateMonth(date.toISOString().slice(0, 7));
    $('button[data-action="shift-month"][data-id="' + button.dataset.id + '"]')?.focus();
  },
  'chart-range': button => {
    const { month: selectedMonth, start, end } = button.dataset;
    month = selectedMonth;
    showTransactions({
      ...(start && { start: Number(start), end: Number(end) }),
      type: chart.income === chart.expense ? 'cashflow' : chart.income ? 'income' : 'expense',
    });
  },
  series: button => chartUpdate(button, () => {
    const key = button.dataset.id;
    if ((chart.income && chart.expense) || !chart[key]) chart[key] = !chart[key];
  }),
  granularity: button => chartUpdate(button, () => { chart.monthly = button.dataset.id === 'month'; }),
  csv: () => download(csv(state, transactions()), 'arus-transaksi-' + (filters.all ? 'semua' : month) + '.csv', 'text/csv;charset=utf-8'),
  xlsx: () => download(xlsx(state, transactions(), filters.all ? t('Semua periode') : monthLabel(month)),
    'arus-transaksi-' + (filters.all ? 'semua' : month) + '.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
  backup: () => download(backup(state), backupName(), 'application/json'),
  import: () => $('#file-input').click(),
  'drive-save': drive.save,
  'drive-restore': drive.restore,
  login,
  sync: async () => { await synchronize(); if (!syncError && navigator.onLine) notify(t('Sinkronisasi selesai.')); },
  'resolve-local': () => modal(t('Utamakan perubahan lokal?'), `<p>${t('Perubahan lokal akan dipakai jika data yang sama juga diedit di perangkat lain.')}</p>`, () => synchronize('local'), t('Gunakan perubahan lokal')),
  'resolve-remote': () => modal(t('Muat versi cloud?'), `<p>${t('Perubahan lokal yang belum disinkronkan akan dibuang. Unduh backup dulu jika masih diperlukan.')}</p>`, () => synchronize('remote'), t('Muat versi cloud')),
  logout: () => {
    const userId = session.user.id;
    const key = scope();
    if (record && hasChanges(record)) throw new Error('Sinkronkan dulu sebelum keluar. Perubahan lokal masih menunggu.');
    modal(t('Keluar dari akun?'), `<p>${t('Salinan cloud di perangkat ini akan dibersihkan.')}</p>`, async () => {
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
      notify(t('Anda sudah keluar.'));
    }, t('Keluar'));
  },
  'telegram-link': linkTelegram,
  'telegram-unlink': async () => {
    await telegram(session.user.id, 'unlink');
    connectedBot = false;
    render();
    notify(t('Tautan Telegram diputus.'));
  },
};
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button || !Object.hasOwn(handlers, button.dataset.action)) return;
  if (!session && button.dataset.action !== 'login') return;
  try { await handlers[button.dataset.action](button); }
  catch (error) { notify(error.message); }
});
function updateMonth(value) {
  month = value;
  filters.all = false;
  delete filters.start;
  delete filters.end;
  render();
}
document.addEventListener('change', event => {
  const field = event.target;
  if (field.dataset.preference) {
    setPreference(field.dataset.preference, field.value);
    if (field.dataset.preference === 'language') {
      render();
      document.getElementById(field.id)?.focus();
    }
    return;
  }
  if (field.id === 'expense-group' || field.id === 'category-group') {
    if (field.id === 'expense-group') chart.group = field.value;
    else categoryGroup = field.value;
    render();
    document.getElementById(field.id)?.focus();
    return;
  }
  const keys = { 'type-filter': 'type', 'account-filter': 'account', 'category-filter': 'category' };
  if (field.id === 'month' && /^\d{4}-\d\d$/.test(field.value)) {
    updateMonth(field.value);
    $('#month')?.focus();
  } else if (field.id === 'all-time') {
    filters.all = field.checked;
    delete filters.start;
    delete filters.end;
    render();
    $('#all-time')?.focus();
  } else if (currentPage === 'transaksi' && Object.hasOwn(keys, field.id)) {
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
render();
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
} catch (error) { signInError = 'Penyimpanan browser tidak tersedia.'; }
openingSession = false;
render();
void synchronize();
if (currentPage === 'pengaturan') void refreshTelegram();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
