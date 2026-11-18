import { accountTypes, balances, categories, dateLabel, newest, providers, rupiah, totals, types, validLogo } from './ledger.mjs';

const paths = {
  dashboard: 'M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z',
  transactions: 'M3 7h17m-4-4 4 4-4 4M21 17H4m4-4-4 4 4 4',
  accounts: 'M3 6h18v14H3z M3 9h18 M16 13h5v4h-5z M3 6l14-3v3',
  categories: 'M4 5h6v6H4z M14 5h6v6h-6z M4 15h6v6H4z M14 15h6v6h-6z',
  settings: 'M4 7h16M4 17h16M8 4v6m8 4v6',
  income: 'm4 17 6-6 4 4 6-9m-6 0h6v6',
  expense: 'm4 7 6 6 4-4 6 9m-6 0h6v-6',
  savings: 'M4 10h16v10H4z M7 10l3-6h4l3 6m-6 4h2',
  calendar: 'M4 6h16v15H4z M4 10h16M8 3v5m8-5v5',
  arrow: 'M5 12h14m-5-5 5 5-5 5',
  cash: 'M3 6h18v12H3z M3 10a4 4 0 0 0 4-4m14 4a4 4 0 0 1-4-4M3 14a4 4 0 0 1 4 4m14-4a4 4 0 0 0-4 4 M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4',
  bank: 'm3 9 9-5 9 5zM5 19h14M7 9v7m5-7v7m5-7v7',
  edit: 'm14 5 5 5M4 20l5-1 11-11-5-5L4 14z',
  download: 'M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4',
  telegram: 'm3 11 18-7-4 16-5-4-2 2-1-5zm6 2 7-5-4 8',
};
export const icon = (name, size = 19) => `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="${paths[name] || paths.cash}"/></svg>`;
export const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
export const option = (value, label, selected) => `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(label)}</option>`;
export const empty = (title, message, action, label, symbol = 'transactions') => `<div class="empty"><div class="mini-icon">${icon(symbol, 22)}</div><strong>${title}</strong><p>${message}</p>${action ? `<button class="secondary" data-action="${action}">${label}</button>` : ''}</div>`;
export const logo = account => {
  const provider = Object.hasOwn(providers, account.provider) ? providers[account.provider] : null;
  if (validLogo(account.logo)) return `<span class="account-logo provider" title="${esc(account.customProvider || provider?.[0] || 'Logo rekening')}"><img src="${account.logo}" alt=""></span>`;
  return provider ? `<span class="account-logo provider" title="${provider[0]}"><img src="./assets/${account.provider}.svg" alt="" data-logo="${account.provider}"><small hidden>${provider[0]}</small></span>` :
    `<span class="account-logo ${account.type}">${icon(account.type === 'wallet' ? 'accounts' : account.type, 19)}</span>`;
};
export const monthLabel = month => dateLabel(month + '-01', { month: 'long', year: 'numeric' });
export function periodControl(month, showAll = false, all = false) {
  return `<div class="period"><label>${icon('calendar', 16)}<input type="month" id="month" aria-label="Pilih bulan" value="${esc(month)}"></label>${showAll ? `<label class="all-time"><input type="checkbox" id="all-time" ${all ? 'checked' : ''}> Semua periode</label>` : ''}</div>`;
}

export function table(state, list, limit = 0) {
  if (!list.length) return empty('Belum ada transaksi', 'Transaksi yang sesuai akan muncul di sini.');
  const accountMap = new Map(state.accounts.map(account => [account.id, account]));
  const categoryMap = new Map(categories(state).map(category => [category.id, category]));
  const shown = [...list].sort(newest).slice(0, limit || list.length);
  return `<div class="table-scroll"><table><thead><tr><th>Transaksi</th><th>Kategori</th><th>Rekening</th><th>Nominal</th><th><span class="sr">Aksi</span></th></tr></thead><tbody>${shown.map(tx => {
    const category = categoryMap.get(tx.category);
    const account = accountMap.get(tx.account);
    const label = tx.note || category?.name || (tx.salary && tx.type === 'income' ? 'Gaji' : types[tx.type]);
    return `<tr><td><div class="table-name"><span class="tx-icon ${tx.type}">${icon(tx.type === 'transfer' ? 'transactions' : tx.type, 17)}</span><div><strong>${esc(label)}</strong><small>${dateLabel(tx.date)}</small></div></div></td><td>${category ? `<span class="category-label"><i style="--dot:${category.group.color}"></i>${esc(category.name)}</span>` : esc(types[tx.type])}</td><td>${esc(account?.name)}${tx.type === 'transfer' ? ' → ' + esc(accountMap.get(tx.to)?.name) : ''}</td><td class="amount ${tx.type}">${tx.type === 'income' ? '+' : tx.type === 'expense' ? '−' : ''}${rupiah(tx.amount)}</td><td><button class="icon-button" data-action="edit-transaction" data-id="${tx.id}" aria-label="Edit ${esc(label)}">${icon('edit', 16)}</button></td></tr>`;
  }).join('')}</tbody></table></div>`;
}

function axis(value) {
  if (value >= 1e6) return 'Rp ' + (value / 1e6).toLocaleString('id-ID') + ' jt';
  if (value >= 1e3) return 'Rp ' + Math.round(value / 1000) + ' rb';
  return 'Rp ' + value;
}
function flowChart(list, month, view) {
  const [year, current] = month.split('-').map(Number);
  const days = new Date(Date.UTC(year, current, 0)).getUTCDate();
  const width = view.daily ? 1 : 7;
  const series = Array.from({ length: Math.ceil(days / width) }, (_, index) => {
    const start = index * width + 1;
    const end = Math.min(start + width - 1, days);
    return { ...totals(list.filter(tx => +tx.date.slice(-2) >= start && +tx.date.slice(-2) <= end)),
      start, end, label: start === end ? String(start) : start + '–' + end };
  });
  const highest = Math.max(4, ...series.flatMap(group => [view.income ? group.income : 0, view.expense ? group.expense : 0]));
  const magnitude = 10 ** Math.floor(Math.log10(highest));
  const step = Math.ceil(highest / magnitude) * magnitude / 4;
  const legend = kind => `<button class="legend-toggle" aria-pressed="${view[kind]}" data-action="series" data-id="${kind}"><i class="${kind}"></i>${types[kind]}</button>`;
  return `<section class="card flow"><div class="card-head"><div><h2>Arus kas</h2><p>Pemasukan dan pengeluaran per periode</p></div><div class="segments compact"><button data-action="granularity" data-id="week" aria-pressed="${!view.daily}">Mingguan</button><button data-action="granularity" data-id="day" aria-pressed="${view.daily}">Harian</button></div></div>
  <div class="flow-legend">${legend('income')}${legend('expense')}</div>
  <div class="chart" style="--columns:${series.length}"><div class="axis">${[4,3,2,1,0].map(value => `<span>${axis(value * step)}</span>`).join('')}</div>
  <div class="plot"><div class="gridlines" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div><div class="bars ${view.daily ? 'daily' : ''}">
  ${series.map((group, index) => `<button class="bar-column" data-action="chart-range" data-start="${group.start}" data-end="${group.end}" aria-label="Tanggal ${group.label}, pemasukan ${rupiah(group.income)}, pengeluaran ${rupiah(group.expense)}"><span class="bar-pair">
    ${view.income ? `<i class="income" style="--height:${group.income / (step * 4) * 100}%"></i>` : ''}${view.expense ? `<i class="expense" style="--height:${group.expense / (step * 4) * 100}%"></i>` : ''}
  </span><span class="x-axis">${!view.daily || index % 5 === 0 ? group.label : ''}</span><span class="chart-tooltip"><b>Tanggal ${group.label}</b><span>Pemasukan ${rupiah(group.income)}</span><span>Pengeluaran ${rupiah(group.expense)}</span></span></button>`).join('')}
  </div></div></div></section>`;
}

function expenses(state, list, selectedGroup) {
  const expenseList = list.filter(tx => tx.type === 'expense');
  const group = state.groups.find(item => item.id === selectedGroup);
  const colors = ['#63e6bd','#9d91ff','#ffc578','#66bafe','#f397af','#a8db77'];
  const items = (group ? group.categories.map((category, index) => ({ ...category, color: colors[index % colors.length] })) : state.groups).map(item => ({
    ...item, value: expenseList.filter(tx => group ? tx.category === item.id : item.categories.some(category => category.id === tx.category)).reduce((sum, tx) => sum + tx.amount, 0),
  })).filter(item => item.value).sort((left, right) => right.value - left.value);
  const subtotal = items.reduce((sum, item) => sum + item.value, 0);
  let cursor = 0;
  const stops = items.map(item => {
    const start = cursor;
    cursor += item.value / subtotal * 100;
    return item.color + ' ' + start + '% ' + cursor + '%';
  });
  return `<section class="card breakdown"><div class="card-head"><div><h2>${group ? esc(group.name) : 'Pengeluaran'}</h2><p>${group ? 'Rincian kategori' : 'Distribusi per kelompok'}</p></div>${group ? '<button class="secondary small" data-action="group">Kembali</button>' : ''}</div>
    <div class="donut" ${subtotal ? `style="--gradient:conic-gradient(${stops.join(',')})"` : ''}><div><small>${group ? 'Total kelompok' : 'Total pengeluaran'}</small><strong>${rupiah(subtotal)}</strong></div></div>
    <div class="breakdown-list">${items.length ? items.map(item => `<button data-action="${group ? 'category-transactions' : 'group'}" data-id="${item.id}"><span><i style="--dot:${item.color}"></i>${esc(item.name)}</span><span>${Math.round(item.value / subtotal * 100)}% ${icon('arrow', 13)}</span></button>`).join('') : '<p class="muted">Belum ada pengeluaran.</p>'}</div></section>`;
}

export function dashboard(state, list, month, view) {
  const current = balances(state);
  const total = Object.values(current).reduce((sum, value) => sum + value, 0);
  const savings = state.accounts.filter(account => account.savings).reduce((sum, account) => sum + current[account.id], 0);
  const sum = totals(list);
  const stats = [
    ['Pemasukan', sum.income, 'income', 'income'],
    ['Pengeluaran', sum.expense, 'expense', 'expense'],
    ['Sisa gaji', sum.salary - sum.salaryExpense, 'savings', 'salary'],
  ];
  return `<div class="page-intro"><div><h1>Ringkasan</h1><p>Pantau saldo, arus kas, dan tabunganmu.</p></div>${periodControl(month)}</div>
    <div class="stat-grid"><section class="card balance-card"><span class="stat-icon">${icon('accounts', 21)}</span><p>Total saldo</p><strong>${rupiah(total)}</strong><small>${state.accounts.length} rekening <span>·</span> Tabungan ${rupiah(savings)}</small></section>
    ${stats.map(([label, amount, symbol, filter]) => `<button class="card stat-card ${filter}" data-action="metric" data-id="${filter}"><span class="stat-icon">${icon(symbol, 20)}</span><p>${label}</p><strong>${rupiah(amount)}</strong><small>${monthLabel(month)} ${icon('arrow', 14)}</small></button>`).join('')}</div>
    <div class="dashboard-grid">${flowChart(list, month, view)}${expenses(state, list, view.group)}</div>
    <section class="card block"><div class="card-head"><div><h2>Transaksi terbaru</h2><p>${monthLabel(month)}</p></div><button class="secondary small" data-action="all-transactions">Lihat semua ${icon('arrow', 15)}</button></div>${table(state, list, 5)}</section>
    <section class="card block"><div class="card-head"><div><h2>Rekening saya</h2></div><button class="secondary small" data-action="add-account">＋ Tambah rekening</button></div>${state.accounts.length ? `<div class="account-strip">${state.accounts.map(account => `<button data-action="account-transactions" data-id="${account.id}">${logo(account)}<span><strong>${esc(account.name)}</strong><small>${rupiah(current[account.id])}</small></span></button>`).join('')}</div>` : empty('Belum ada rekening', 'Tambahkan bank, e-wallet, atau dompet tunai.', 'add-account', 'Tambah rekening', 'accounts')}</section>`;
}

export function accountsPage(state) {
  const current = balances(state);
  return `<div class="page-intro"><div><h1>Rekening</h1><p>Kelola bank, e-wallet, dan uang tunai dalam satu tempat.</p></div><button class="secondary" data-action="add-account">＋ Tambah rekening</button></div>
    ${state.accounts.length ? `<div class="accounts-grid">${state.accounts.map(account => `<section class="card account-card"><div class="account-head">${logo(account)}<button class="icon-button" data-action="edit-account" data-id="${account.id}" aria-label="Edit ${esc(account.name)}">${icon('edit')}</button></div><h2>${esc(account.name)}</h2><p>${accountTypes[account.type]}${account.customProvider ? ' · ' + esc(account.customProvider) : ''}${account.savings ? ' · Tabungan' : ''}</p><strong>${rupiah(current[account.id])}</strong><button class="text-button" data-action="account-transactions" data-id="${account.id}">Lihat transaksi ${icon('arrow', 16)}</button></section>`).join('')}</div>` : `<section class="card">${empty('Tambahkan rekening pertama', 'Masukkan saldo sebelum transaksi pertama.', 'add-account', 'Tambah rekening', 'accounts')}</section>`}`;
}

export function categoriesPage(state) {
  return `<div class="page-intro"><div><h1>Kategori</h1><p>Susun kategori pengeluaran berdasarkan kelompok.</p></div><button class="secondary" data-action="add-group">＋ Tambah kelompok</button></div>
    ${state.groups.length ? `<div class="accounts-grid">${state.groups.map(group => `<section class="card account-card"><div class="card-head"><h2><i class="dot" style="--dot:${group.color}"></i>${esc(group.name)} ${group.archived ? '<small>Diarsipkan</small>' : ''}</h2><button class="icon-button" data-action="edit-group" data-id="${group.id}" aria-label="Edit ${esc(group.name)}">${icon('edit')}</button></div><div class="category-rows">${group.categories.map(category => `<button data-action="edit-category" data-id="${category.id}" data-group="${group.id}"><span>${esc(category.name)}${category.archived ? ' <small>Diarsipkan</small>' : ''}</span>${icon('edit', 14)}</button>`).join('')}</div><button class="text-button" data-action="add-category" data-group="${group.id}">＋ Tambah kategori</button></section>`).join('')}</div>` : empty('Belum ada kelompok', 'Buat kelompok untuk mengatur pengeluaran.', 'add-group', 'Tambah kelompok')}`;
}
