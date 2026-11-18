export const rupiah = value => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
export const integer = value => Number.isSafeInteger(value) && Math.abs(value) <= 1e12;
export function formatAmount(value) {
  const digits = String(value).replace(/[.\s]/g, '');
  return /^-?\d+$/.test(digits)
    ? digits.replace(/^(-?)0+(?=\d)/, '$1').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
    : String(value);
}
export function parseAmount(value, minimum = 1) {
  const input = String(value).trim();
  const amount = /^-?(?:\d+|\d{1,3}(?:\.\d{3})+)$/.test(input) ? Number(input.replaceAll('.', '')) : NaN;
  if (!integer(amount) || amount < minimum) throw new Error('Masukkan nominal rupiah bulat yang valid.');
  return amount;
}
export const maxLogoLength = 55000;
export const validLogo = value => typeof value === 'string' && value.length <= maxLogoLength &&
  /^data:image\/(?:png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
export const id = () => crypto.randomUUID();
export const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Jakarta' }).format(new Date());
export const dateLabel = (value, options = { day: 'numeric', month: 'short' }, locale = 'id-ID') =>
  new Date(value + 'T12:00:00Z').toLocaleDateString(locale, { ...options, timeZone: 'UTC' });

export const providers = {
  bca: ['BCA', 'bank', '#1762a7'], mandiri: ['Mandiri', 'bank', '#155282'],
  bri: ['BRI', 'bank', '#146fbc'], bni: ['BNI', 'bank', '#008381'],
  bsi: ['BSI', 'bank', '#00a993'], jago: ['Jago', 'bank', '#b6770e'],
  gopay: ['GoPay', 'wallet', '#007ec0'], ovo: ['OVO', 'wallet', '#6242a7'],
  dana: ['DANA', 'wallet', '#168ae0'], shopeepay: ['ShopeePay', 'wallet', '#cf4b33'],
  linkaja: ['LinkAja', 'wallet', '#ca3550'],
};

export const initial = () => ({
  accounts: [],
  groups: [
    { id: 'needs', name: 'Kebutuhan', color: '#63e6bd', categories: [
      { id: 'food', name: 'Makan' }, { id: 'transport', name: 'Transportasi' },
      { id: 'bills', name: 'Tagihan' }, { id: 'groceries', name: 'Belanja bulanan' },
    ] },
    { id: 'wants', name: 'Keinginan', color: '#9d91ff', categories: [
      { id: 'shopping', name: 'Belanja' }, { id: 'fun', name: 'Hiburan' }, { id: 'subs', name: 'Langganan' },
    ] },
    { id: 'other', name: 'Lainnya', color: '#ffc578', categories: [{ id: 'misc', name: 'Lain-lain' }] },
  ],
  transactions: [],
  obligations: [],
});

export const palettes = ['#63e6bd', '#9d91ff', '#ffc578', '#66bafe', '#f397af', '#a8db77'];
export const types = { income: 'Pemasukan', expense: 'Pengeluaran', transfer: 'Transfer' };
export const accountTypes = { bank: 'Bank', wallet: 'E-wallet', cash: 'Tunai' };
export const categoryReviewFilter = ':review';
export const categories = state => state.groups.flatMap(group => group.categories.map(category => ({ ...category, group })));
export const newest = (left, right) => right.date.localeCompare(left.date) || (right.created || '').localeCompare(left.created || '');

const validDate = value => {
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value;
};

function monthlyDue(start, offset) {
  const month = new Date(start.slice(0, 7) + '-01T00:00:00Z');
  month.setUTCMonth(month.getUTCMonth() + offset + 1, 0);
  if (!Number.isFinite(+month) || month.getUTCFullYear() > 9999) return '';
  return month.toISOString().slice(0, 8) + String(Math.min(month.getUTCDate(), Number(start.slice(-2)))).padStart(2, '0');
}

export function obligationProgress(item, payments) {
  const paid = payments.reduce((sum, tx) => sum + tx.amount, 0);
  if (item.kind === 'loan') {
    const remaining = item.balance - paid;
    const due = remaining > 0 ? monthlyDue(item.firstDue, Math.floor(paid / item.amount)) : '';
    return { paid, remaining, due, amount: Math.min(remaining, item.amount - paid % item.amount) };
  }
  const covered = new Set(payments.map(tx => tx.dueMonth));
  let offset = 0;
  let due = item.firstDue;
  while (due && covered.has(due.slice(0, 7))) due = monthlyDue(item.firstDue, ++offset);
  return { paid, due, amount: item.amount };
}

export function recordObligationPayment(state, planId, dueMonth, payment) {
  const item = (state.obligations || []).find(plan => plan.id === planId);
  if (!item || item.archived) throw new Error('Jadwal pembayaran sudah tidak aktif.');
  const progress = obligationProgress(item, state.transactions.filter(tx => tx.obligation === planId));
  if (item.kind === 'bill' && progress.due.slice(0, 7) !== dueMonth) {
    throw new Error('Periode tagihan sudah berubah. Buka formulir pembayaran lagi.');
  }
  if (item.kind === 'loan' && payment.amount > progress.remaining) {
    throw new Error('Pembayaran melebihi sisa pinjaman.');
  }
  state.transactions.push({
    ...payment, type: 'expense', obligation: planId,
    ...(item.kind === 'bill' && { dueMonth }),
  });
}

export function validate(state) {
  const fail = () => { throw new Error('Struktur data Arus tidak valid.'); };
  const validList = list => Array.isArray(list) && list.every(item => item && typeof item.id === 'string' && /^[\w-]{1,100}$/.test(item.id)) &&
    new Set(list.map(item => item.id)).size === list.length;
  const validName = name => typeof name === 'string' && name.trim().length > 0 && name.length <= 80;
  if (!state || !validList(state.accounts) || !validList(state.groups) || !validList(state.transactions)) fail();
  for (const account of state.accounts) {
    if (!validName(account.name) || !Object.hasOwn(accountTypes, account.type) || !integer(account.opening) ||
      (account.provider && (!Object.hasOwn(providers, account.provider) || providers[account.provider][1] !== account.type)) ||
      (account.customProvider !== undefined && (!validName(account.customProvider) || account.provider || account.type === 'cash')) ||
      (account.logo !== undefined && !validLogo(account.logo)) ||
      typeof account.savings !== 'boolean') fail();
  }
  for (const group of state.groups) {
    if (!validName(group.name) || !palettes.includes(group.color) || !validList(group.categories) ||
      !group.categories.every(category => validName(category.name))) fail();
  }
  const accounts = new Set(state.accounts.map(account => account.id));
  const allCategories = categories(state);
  if (!validList(allCategories)) fail();
  const categoryIds = new Set(allCategories.map(category => category.id));
  const obligations = state.obligations === undefined ? [] : state.obligations;
  if (!validList(obligations)) fail();
  const plans = new Map(obligations.map(item => [item.id, item]));
  for (const item of obligations) {
    if (!validName(item.name) || !['loan', 'bill'].includes(item.kind) || !validDate(item.firstDue) ||
      !integer(item.amount) || item.amount <= 0 || typeof item.archived !== 'boolean' ||
      (item.kind === 'loan' && (!integer(item.balance) || item.balance <= 0))) fail();
  }
  const paidPeriods = new Map();
  const loanTotals = new Map();
  for (const tx of state.transactions) {
    if (!Object.hasOwn(types, tx.type) || !integer(tx.amount) || tx.amount <= 0 ||
      !validDate(tx.date) ||
      typeof tx.created !== 'string' || !Number.isFinite(Date.parse(tx.created)) ||
      !accounts.has(tx.account) || typeof tx.note !== 'string' || tx.note.length > 160 ||
      (tx.needsCategory !== undefined && (tx.needsCategory !== true || tx.type !== 'expense' || tx.category !== '' || !tx.note.trim())) ||
      (tx.type === 'expense' && !tx.needsCategory && !categoryIds.has(tx.category)) ||
      (tx.type === 'transfer' && (!accounts.has(tx.to) || tx.to === tx.account))) fail();
    if (tx.obligation === undefined && tx.dueMonth === undefined) continue;
    const plan = plans.get(tx.obligation);
    if (!plan || tx.type !== 'expense') fail();
    if (plan.kind === 'bill') {
      const period = tx.dueMonth;
      if (typeof period !== 'string' || !validDate(period + '-01') || period < plan.firstDue.slice(0, 7)) fail();
      const periods = paidPeriods.get(plan.id) || new Set();
      if (periods.has(period)) fail();
      periods.add(period);
      paidPeriods.set(plan.id, periods);
    } else {
      const total = (loanTotals.get(plan.id) || 0) + tx.amount;
      if (tx.dueMonth !== undefined || total > plan.balance) fail();
      loanTotals.set(plan.id, total);
    }
  }
  return state.obligations === undefined ? { ...state, obligations } : state;
}

export function balances(state, through = today()) {
  const values = Object.fromEntries(state.accounts.map(account => [account.id, account.opening]));
  for (const tx of state.transactions) {
    if (tx.date > through) continue;
    values[tx.account] += tx.type === 'income' ? tx.amount : -tx.amount;
    if (tx.type === 'transfer') values[tx.to] += tx.amount;
  }
  return values;
}

export function totals(list) {
  const result = { income: 0, expense: 0, salary: 0, salaryExpense: 0 };
  for (const tx of list) {
    if (tx.type === 'transfer') continue;
    result[tx.type] += tx.amount;
    if (tx.salary && tx.type === 'income') result.salary += tx.amount;
    if (tx.salary && tx.type === 'expense') result.salaryExpense += tx.amount;
  }
  return result;
}
