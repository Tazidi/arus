import { catalogIcon, isDefaultGroup } from './category-catalog.mjs';
import { categoryExamples, categoryName, groupName, locale, t } from './preferences.mjs';
import { accountTypes, balances, billPeriodAt, categories, categoryReviewFilter, dateLabel, newest, obligationProgress, providers, rupiah, today, totals, types, validLogo } from './ledger.mjs';

const paths = {
  bills: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6m-6 4h6m-6 4h3',
  appearance: 'M3 4h18v13H3z M8 21h8m-4-4v4',
  dashboard: 'M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z',
  transactions: 'M3 7h17m-4-4 4 4-4 4M21 17H4m4-4-4 4 4 4',
  accounts: 'M3 6h18v14H3z M3 9h18 M16 13h5v4h-5z M3 6l14-3v3',
  categories: 'M4 5h6v6H4z M14 5h6v6h-6z M4 15h6v6H4z M14 15h6v6h-6z',
  settings: 'M4 7h16M4 17h16M8 4v6m8 4v6',
  income: 'm4 17 6-6 4 4 6-9m-6 0h6v6',
  expense: 'm4 7 6 6 4-4 6 9m-6 0h6v-6',
  savings: 'M4 10h16v10H4z M7 10l3-6h4l3 6m-6 4h2',
  calendar: 'M4 6h16v15H4z M4 10h16M8 3v5m8-5v5',
  previous: 'm15 6-6 6 6 6',
  next: 'm9 6 6 6-6 6',
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
export const empty = (title, message, action, label, symbol = 'transactions') => `<div class="empty"><div class="mini-icon">${icon(symbol, 22)}</div><strong>${t(title)}</strong><p>${t(message)}</p>${action ? `<button class="secondary" data-action="${action}">${t(label)}</button>` : ''}</div>`;
export const logo = account => {
  const provider = Object.hasOwn(providers, account.provider) ? providers[account.provider] : null;
  if (validLogo(account.logo)) return `<span class="account-logo provider" title="${esc(account.customProvider || provider?.[0] || t('Logo rekening'))}"><img src="${account.logo}" alt=""></span>`;
  return provider ? `<span class="account-logo provider" title="${provider[0]}"><img src="./assets/${account.provider}.svg" alt="" data-logo="${account.provider}"><small hidden>${provider[0]}</small></span>` :
    `<span class="account-logo ${account.type}">${icon(account.type === 'wallet' ? 'accounts' : account.type, 19)}</span>`;
};
export const monthLabel = month => dateLabel(month + '-01', { month: 'long', year: 'numeric' }, locale());
export function periodControl(month, showAll = false, all = false) {
  return `<div class="period"><div class="month-picker">
    <button class="icon-button" data-action="shift-month" data-id="-1" aria-label="${t('Bulan sebelumnya')}" title="${t('Bulan sebelumnya')}">${icon('previous', 17)}</button><label>${icon('calendar', 16)}<input type="month" id="month" aria-label="${t('Pilih bulan')}" value="${esc(month)}"></label>
    <button class="icon-button" data-action="shift-month" data-id="1" aria-label="${t('Bulan berikutnya')}" title="${t('Bulan berikutnya')}">${icon('next', 17)}</button></div>${showAll ? `<label class="all-time"><input type="checkbox" id="all-time" ${all ? 'checked' : ''}> ${t('Semua periode')}</label>` : ''}</div>`;
}

export function table(state, list, limit = 0) {
  if (!list.length) return empty('Belum ada transaksi', 'Transaksi yang sesuai akan muncul di sini.');
  const accountMap = new Map(state.accounts.map(account => [account.id, account]));
  const categoryMap = new Map(categories(state).map(category => [category.id, category]));
  const shown = [...list].sort(newest).slice(0, limit || list.length);
  return `<div class="table-scroll"><table><thead><tr><th>${t('Transaksi')}</th><th class="tx-desktop-meta">${t('Kategori')}</th><th class="tx-desktop-meta">${t('Rekening')}</th><th>${t('Nominal')}</th><th><span class="sr">${t('Aksi')}</span></th></tr></thead><tbody>${shown.map(tx => {
    const category = categoryMap.get(tx.category);
    const account = accountMap.get(tx.account);
    const reviewLabel = tx.needsCategory ? t('Perlu kategori') : '';
    const accountLabel = esc(account?.name) + (tx.type === 'transfer' ? ' → ' + esc(accountMap.get(tx.to)?.name) : '');
    const adjustment = tx.type === 'adjustment';
    const label = adjustment ? t('Penyesuaian saldo') : tx.note || (category ? categoryName(category) : '') || (tx.salary && tx.type === 'income' ? t('Gaji') : t(types[tx.type]));
    return `<tr><td><div class="table-name"><span class="tx-icon ${tx.type}">${icon(adjustment ? 'settings' : tx.type === 'transfer' ? 'transactions' : tx.type, 17)}</span><div><strong>${esc(label)}</strong><small>${dateLabel(tx.date, undefined, locale())}<span class="tx-mobile-meta"> · ${accountLabel}${reviewLabel ? ' · ' + reviewLabel : category && tx.note ? ' · ' + esc(categoryName(category)) : ''}</span></small></div></div></td><td class="tx-desktop-meta">${category ? `<span class="category-label"><span aria-hidden="true">${esc(catalogIcon(category))}</span>${esc(categoryName(category))}</span>` : reviewLabel ? `<span class="category-review">${reviewLabel}</span>` : esc(t(types[tx.type]))}</td><td class="tx-desktop-meta">${accountLabel}</td><td class="amount ${tx.type}">${tx.type === 'income' || (adjustment && tx.amount > 0) ? '+' : tx.type === 'expense' ? '−' : ''}${rupiah(tx.amount)}</td><td><button class="icon-button" data-action="edit-transaction" data-id="${tx.id}" aria-label="${esc(t(adjustment ? 'Lihat {name}' : 'Edit {name}', { name: label }))}">${icon(adjustment ? 'arrow' : 'edit', 16)}</button></td></tr>`;
  }).join('')}</tbody></table></div>`;
}

function axis(value) {
  if (locale() === 'en-US' && value >= 1e3) return 'Rp ' + new Intl.NumberFormat(locale(), { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  if (value >= 1e6) return 'Rp ' + (value / 1e6).toLocaleString('id-ID') + ' jt';
  if (value >= 1e3) return 'Rp ' + Math.round(value / 1000) + ' rb';
  return 'Rp ' + value;
}
function weeklyCashFlow(list, month) {
  const lastDay = new Date(month + '-01T00:00:00Z');
  lastDay.setUTCMonth(lastDay.getUTCMonth() + 1, 0);
  const days = lastDay.getUTCDate();
  return Array.from({ length: Math.ceil(days / 7) }, (_, index) => {
    const start = index * 7 + 1;
    const end = Math.min(start + 6, days);
    const label = start === end ? String(start) : start + '–' + end;
    return { ...totals(list.filter(tx => +tx.date.slice(-2) >= start && +tx.date.slice(-2) <= end)),
      month, start, end, label, period: t('Tanggal {range}', { range: label }) };
  });
}

function monthlyCashFlow(transactions, year) {
  const byMonth = Array.from({ length: 12 }, () => []);
  for (const tx of transactions) {
    if (tx.date.slice(0, 4) === year) byMonth[Number(tx.date.slice(5, 7)) - 1].push(tx);
  }
  return byMonth.map((list, index) => {
    const month = year + '-' + String(index + 1).padStart(2, '0');
    return { ...totals(list), month, label: dateLabel(month + '-01', { month: 'short' }, locale()), period: monthLabel(month) };
  });
}

function flowChart(state, list, month, view) {
  const year = month.slice(0, 4);
  const series = view.monthly ? monthlyCashFlow(state.transactions, year) : weeklyCashFlow(list, month);
  const highest = Math.max(4, ...series.flatMap(group => [view.income ? group.income : 0, view.expense ? group.expense : 0]));
  const magnitude = 10 ** Math.floor(Math.log10(highest));
  const step = Math.ceil(highest / magnitude) * magnitude / 4;
  const legend = kind => `<button class="legend-toggle" aria-pressed="${view[kind]}" data-action="series" data-id="${kind}"><i class="${kind}"></i>${t(types[kind])}</button>`;
  return `<section class="card flow"><div class="card-head"><div><h2>${t('Arus kas')}</h2><p>${view.monthly ? year : monthLabel(month)}</p></div><div class="segments compact"><button data-action="granularity" data-id="week" aria-pressed="${!view.monthly}">${t('Mingguan')}</button><button data-action="granularity" data-id="month" aria-pressed="${view.monthly}">${t('Bulanan')}</button></div></div>
  <div class="flow-legend">${legend('income')}${legend('expense')}</div>
  <div class="chart" style="--columns:${series.length}"><div class="axis">${[4,3,2,1,0].map(value => `<span>${axis(value * step)}</span>`).join('')}</div>
  <div class="plot"><div class="gridlines" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div><div class="bars ${view.monthly ? 'monthly' : ''}">
  ${series.map(group => `<button class="bar-column" data-action="chart-range" data-month="${group.month}"
    ${view.monthly ? (group.month === month ? 'aria-current="date"' : '') : `data-start="${group.start}" data-end="${group.end}"`}
    aria-label="${t('{period}, pemasukan {income}, pengeluaran {expense}', { period: group.period, income: rupiah(group.income), expense: rupiah(group.expense) })}"><span class="bar-pair">
    ${view.income ? `<i class="income" style="--height:${group.income / (step * 4) * 100}%"></i>` : ''}${view.expense ? `<i class="expense" style="--height:${group.expense / (step * 4) * 100}%"></i>` : ''}
  </span><span class="x-axis">${group.label}</span><span class="chart-tooltip"><b>${group.period}</b><span>${t('Pemasukan {amount}', { amount: rupiah(group.income) })}</span><span>${t('Pengeluaran {amount}', { amount: rupiah(group.expense) })}</span></span></button>`).join('')}
  </div></div></div></section>`;
}

function expenses(state, list, selectedGroup) {
  const sums = new Map();
  for (const tx of list) {
    if (tx.type !== 'expense') continue;
    const key = tx.needsCategory ? categoryReviewFilter : tx.category;
    sums.set(key, (sums.get(key) || 0) + tx.amount);
  }
  const items = categories(state).filter(item => sums.has(item.id) && (!selectedGroup || item.group.id === selectedGroup))
    .map(item => ({ id: item.id, label: categoryName(item), icon: catalogIcon(item), value: sums.get(item.id) }));
  if (!selectedGroup && sums.has(categoryReviewFilter)) {
    items.push({ id: categoryReviewFilter, label: t('Perlu kategori'), value: sums.get(categoryReviewFilter) });
  }
  items.sort((left, right) => right.value - left.value);
  const subtotal = items.reduce((sum, item) => sum + item.value, 0);
  const groups = state.groups.filter(group => !isDefaultGroup(group) && (!group.archived || group.id === selectedGroup ||
    group.categories.some(category => sums.has(category.id))));

  return `<section class="card breakdown">
    <div class="card-head"><div><h2>${t('Pengeluaran per kategori')}</h2><p>${t('Total pengeluaran')}</p><strong class="breakdown-total">${rupiah(subtotal)}</strong></div>
    ${groups.length ? `<select class="group-filter" id="expense-group" aria-label="${t('Filter kelompok')}">${option('', t('Semua kelompok'), selectedGroup)}${groups.map(group => option(group.id, groupName(group), selectedGroup)).join('')}</select>` : ''}</div>
    <div class="breakdown-list">${items.length ? items.map(item => {
      const share = item.value / subtotal * 100;
      return `<button data-action="category-transactions" data-id="${item.id}">
        <span class="breakdown-row"><span>${item.icon ? `<span aria-hidden="true">${esc(item.icon)}</span>` : '<i></i>'}${esc(item.label)}</span><strong>${rupiah(item.value)}</strong></span>
        <span class="category-meter" aria-hidden="true"><i style="--share:${share}%"></i></span>
      </button>`;
    }).join('') : `<p class="muted">${t('Belum ada pengeluaran.')}</p>`}</div>
  </section>`;
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
  return `<div class="page-intro"><div><h1>${t('Ringkasan')}</h1><p>${t('Pantau saldo, arus kas, dan tabunganmu.')}</p></div>${periodControl(month)}</div>
    <div class="stat-grid"><section class="card balance-card"><span class="stat-icon">${icon('accounts', 21)}</span><p>${t('Total saldo')}</p><strong>${rupiah(total)}</strong><small>${t(state.accounts.length === 1 ? '1 rekening' : '{count} rekening', { count: state.accounts.length })} <span>·</span> ${t('Tabungan {amount}', { amount: rupiah(savings) })}</small></section>
    ${stats.map(([label, amount, symbol, filter]) => `<button class="card stat-card ${filter}" data-action="metric" data-id="${filter}"><span class="stat-icon">${icon(symbol, 20)}</span><p>${t(label)}</p><strong>${rupiah(amount)}</strong><small>${monthLabel(month)} ${icon('arrow', 14)}</small></button>`).join('')}</div>
    <div class="dashboard-grid">${flowChart(state, list, month, view)}${expenses(state, list, view.group)}</div>
    <section class="card block"><div class="card-head"><div><h2>${t('Transaksi terbaru')}</h2><p>${monthLabel(month)}</p></div><button class="secondary small" data-action="all-transactions">${t('Lihat semua')} ${icon('arrow', 15)}</button></div>${table(state, list, 5)}</section>
    <section class="card block"><div class="card-head"><div><h2>${t('Rekening saya')}</h2></div><button class="secondary small" data-action="add-account">＋ ${t('Tambah rekening')}</button></div>${state.accounts.length ? `<div class="account-strip">${state.accounts.map(account => `<button data-action="account-transactions" data-id="${account.id}">${logo(account)}<span><strong>${esc(account.name)}</strong><small>${rupiah(current[account.id])}</small></span></button>`).join('')}</div>` : empty('Belum ada rekening', 'Tambahkan bank, e-wallet, atau dompet tunai.', 'add-account', 'Tambah rekening', 'accounts')}</section>`;
}

export function accountsPage(state) {
  const current = balances(state);
  return `<div class="page-intro"><div><h1>${t('Rekening')}</h1><p>${t('Kelola bank, e-wallet, dan uang tunai dalam satu tempat.')}</p></div><button class="secondary" data-action="add-account">＋ ${t('Tambah rekening')}</button></div>
    ${state.accounts.length ? `<div class="accounts-grid">${state.accounts.map(account => `<section class="card account-card"><div class="account-head">${logo(account)}<button class="icon-button" data-action="edit-account" data-id="${account.id}" aria-label="${esc(t('Edit {name}', { name: account.name }))}">${icon('edit')}</button></div><h2>${esc(account.name)}</h2><p>${t(accountTypes[account.type])}${account.customProvider ? ' · ' + esc(account.customProvider) : ''}${account.savings ? ' · ' + t('Tabungan') : ''}</p><strong>${rupiah(current[account.id])}</strong><div class="inline"><button class="secondary small" data-action="adjust-balance" data-id="${account.id}">${t('Edit saldo')}</button><button class="text-button" data-action="account-transactions" data-id="${account.id}">${t('Lihat transaksi')} ${icon('arrow', 16)}</button></div></section>`).join('')}</div>` : `<section class="card">${empty('Tambahkan rekening pertama', 'Masukkan saldo sebelum transaksi pertama.', 'add-account', 'Tambah rekening', 'accounts')}</section>`}`;
}

export function categoriesPage(state, selectedGroup, manageGroups) {
  const groups = state.groups.filter(group => !isDefaultGroup(group));
  const items = categories(state).filter(item => !selectedGroup || item.group.id === selectedGroup)
    .sort((left, right) => Number(!!(left.archived || left.group.archived)) - Number(!!(right.archived || right.group.archived)) ||
      categoryName(left).localeCompare(categoryName(right), locale()));
  return `<div class="page-intro"><div><h1>${t('Kategori')}</h1><p>${t('Kelola kategori yang digunakan untuk mencatat pengeluaran.')}</p></div>
    <button class="secondary" data-action="add-category">＋ ${t('Tambah kategori')}</button></div>
    <section class="card category-panel"><div class="card-head"><h2>${t('Daftar kategori')}</h2>
      ${groups.length ? `<select class="group-filter" id="category-group" aria-label="${t('Filter kelompok')}">${option('', t('Semua kelompok'), selectedGroup)}${groups.map(group => option(group.id, groupName(group), selectedGroup)).join('')}</select>` : ''}</div>
      ${items.length ? `<div class="category-directory">${items.map(item => `<button data-action="edit-category" data-id="${item.id}" data-group="${item.group.id}">
        <span class="category-icon" aria-hidden="true">${esc(catalogIcon(item))}</span><span class="category-copy"><strong>${esc(categoryName(item))}</strong>${categoryExamples(item) ? `<small>${esc(categoryExamples(item))}</small>` : ''}${item.archived || item.group.archived ? `<small>${t('Diarsipkan')}</small>` : ''}</span>${icon('edit', 16)}</button>`).join('')}</div>`
        : empty('Belum ada kategori', 'Tambahkan kategori untuk mengelompokkan pengeluaran.', null, null, 'categories')}</section>
    <details class="card group-manager" id="manage-groups" ${manageGroups ? 'open' : ''}><summary>${t('Kelola kelompok')}</summary>
      <div class="group-controls"><p class="muted">${t('Kelompok bersifat opsional dan bisa dipakai untuk memfilter ringkasan.')}</p>
      <div class="category-rows">${groups.map(group => `<button data-action="edit-group" data-id="${group.id}">
        <span><i class="dot" style="--dot:${group.color}"></i>${esc(groupName(group))} ${group.archived ? `<small>${t('Diarsipkan')}</small>` : ''}</span>${icon('edit', 16)}</button>`).join('')}</div>
      <button class="secondary small" data-action="add-group">＋ ${t('Tambah kelompok')}</button></div></details>`;
}

export function obligationsPage(state) {
  const asOf = today();
  const accountNames = new Map(state.accounts.map(account => [account.id, account.name]));
  const payments = new Map();
  for (const tx of state.transactions) {
    if (!tx.obligation) continue;
    if (!payments.has(tx.obligation)) payments.set(tx.obligation, []);
    payments.get(tx.obligation).push(tx);
  }
  const plans = (state.obligations || []).map(item => {
    const history = payments.get(item.id) || [];
    return { item, history, progress: obligationProgress(item, history) };
  }).sort((left, right) => (left.progress.due || '9999-99').localeCompare(right.progress.due || '9999-99') ||
    left.item.name.localeCompare(right.item.name, locale()));
  const card = ({ item, history, progress }) => {
    const loan = item.kind === 'loan';
    const settled = loan ? progress.remaining === 0 : progress.remainingPeriods === 0;
    const billAmountLabel = item.duration || (progress.due && progress.amount !== item.amount) ? 'Nominal periode berikutnya' : 'Nominal per bulan';
    const late = !item.archived && progress.due && progress.due < asOf;
    const latest = history.reduce((last, tx) => !last || newest(tx, last) < 0 ? tx : last, null);
    const status = item.archived ? 'Diarsipkan' : settled ? 'Lunas' : late ? 'Lewat jatuh tempo' :
      progress.due === asOf ? 'Jatuh tempo hari ini' : '';
    return `<article class="card obligation-card">
      <div class="card-head"><div><p>${t(loan ? 'Pinjaman' : 'Tagihan bulanan')}</p><h2>${esc(item.name)}</h2></div>
      <button class="icon-button" data-action="edit-obligation" data-id="${item.id}" aria-label="${esc(t('Edit {name}', { name: item.name }))}">${icon('edit')}</button></div>
      <dl class="obligation-figures">
        ${loan || !settled ? `<div><dt>${t(loan ? 'Sisa pinjaman' : billAmountLabel)}</dt><dd>${rupiah(loan ? progress.remaining : progress.due ? progress.amount : item.amount)}</dd></div>` : ''}
        ${progress.remainingPeriods !== undefined ? `<div><dt>${t('Sisa periode')}</dt><dd>${t('{remaining} dari {total} bulan', { remaining: progress.remainingPeriods, total: item.duration })}</dd></div>` : ''}
        ${progress.due && !item.archived ? `<div><dt>${t('Jatuh tempo berikutnya')}</dt><dd class="obligation-date">${dateLabel(progress.due, { day: 'numeric', month: 'short', year: 'numeric' }, locale())}</dd></div>` : ''}
      </dl>
      ${status ? `<span class="obligation-status ${late ? 'overdue' : ''}">${t(status)}</span>` : ''}
      ${loan && !settled && !item.archived && progress.amount !== item.amount ? `<p class="muted">${t('Sisa cicilan ini {amount}', { amount: rupiah(progress.amount) })}</p>` : ''}
      ${latest ? `<p class="muted">${t('Terakhir dibayar {amount} · {date}', { amount: rupiah(latest.amount), date: dateLabel(latest.date, undefined, locale()) })} · ${esc(accountNames.get(latest.account))}</p>` : ''}
      <div class="inline">
        ${!item.archived && !settled && (loan || progress.due) ? `<button class="secondary" data-action="pay-obligation" data-id="${item.id}">${t('Catat pembayaran')}</button>` : ''}
        ${!loan ? `<button class="secondary small" data-action="bill-schedule" data-id="${item.id}">${t('Rincian per bulan')}</button>` : ''}
        ${history.length ? `<button class="text-button" data-action="obligation-history" data-id="${item.id}">${t('Riwayat pembayaran')} ${icon('arrow', 14)}</button>` : ''}
      </div>
    </article>`;
  };
  const active = plans.filter(plan => !plan.item.archived);
  const archived = plans.filter(plan => plan.item.archived);
  return `<div class="page-intro"><div><h1>${t('Pinjaman & Tagihan')}</h1><p>${t('Pantau cicilan, tagihan bulanan, dan tanggal jatuh tempo.')}</p></div>
    <button class="primary" data-action="add-obligation">＋ ${t('Tambah jadwal')}</button></div>
    ${active.length ? `<div class="obligations-grid">${active.map(card).join('')}</div>` :
      `<section class="card">${empty('Belum ada jadwal aktif', 'Tambahkan pinjaman atau tagihan bulanan untuk mulai mencatat.', null, null, 'bills')}</section>`}
    ${archived.length ? `<details class="card group-manager"><summary>${t('Jadwal diarsipkan')}</summary>
      <div class="group-controls obligations-grid">${archived.map(card).join('')}</div></details>` : ''}`;
}

export const billSchedulePageSize = 12;

export function billScheduleBody(item, history, offset) {
  const byMonth = new Map(history.map(tx => [tx.dueMonth, tx]));
  const periods = Array.from({ length: billSchedulePageSize }, (_, index) => billPeriodAt(item, offset + index)).filter(Boolean);
  const controls = (next, label) => `<button type="button" class="secondary small" data-action="bill-schedule"
    data-id="${item.id}" data-offset="${next}">${t(label)}</button>`;
  return `<p class="muted">${esc(item.name)}</p>
    <div class="bill-periods">${periods.map(period => {
      const payment = byMonth.get(period.month);
      const title = monthLabel(period.month);
      return `<section class="bill-period">
        <div class="bill-period-head"><strong>${title}</strong><span class="muted">${dateLabel(period.due, undefined, locale())}</span></div>
        <dl>
          <div><dt>${t('Rencana')}</dt><dd>${rupiah(payment?.scheduledAmount ?? period.amount)}</dd></div>
          <div><dt>${t('Dibayar')}</dt><dd>${payment ? rupiah(payment.amount) : '—'}</dd></div>
        </dl>
        ${!payment && !item.archived ? `<button type="button" class="icon-button" data-action="edit-bill-amount"
          data-id="${item.id}" data-month="${period.month}" aria-label="${esc(t('Ubah nominal {month}', { month: title }))}">${icon('edit', 16)}</button>` : ''}
      </section>`;
    }).join('')}</div>
    ${offset || billPeriodAt(item, offset + billSchedulePageSize) ? `<div class="inline">
      ${offset ? controls(Math.max(0, offset - billSchedulePageSize), 'Sebelumnya') : ''}
      ${billPeriodAt(item, offset + billSchedulePageSize) ? controls(offset + billSchedulePageSize, 'Berikutnya') : ''}
    </div>` : ''}`;
}
