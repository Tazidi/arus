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
export const dateLabel = (value, options = { day: 'numeric', month: 'short' }) =>
  new Date(value + 'T12:00:00Z').toLocaleDateString('id-ID', { ...options, timeZone: 'UTC' });

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
});

export const palettes = ['#63e6bd', '#9d91ff', '#ffc578', '#66bafe', '#f397af', '#a8db77'];
export const types = { income: 'Pemasukan', expense: 'Pengeluaran', transfer: 'Transfer' };
export const accountTypes = { bank: 'Bank', wallet: 'E-wallet', cash: 'Tunai' };
export const categories = state => state.groups.flatMap(group => group.categories.map(category => ({ ...category, group })));
export const newest = (left, right) => right.date.localeCompare(left.date) || (right.created || '').localeCompare(left.created || '');

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
  for (const tx of state.transactions) {
    const parsed = new Date(tx.date + 'T00:00:00Z');
    if (!Object.hasOwn(types, tx.type) || !integer(tx.amount) || tx.amount <= 0 ||
      typeof tx.date !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(tx.date) ||
      !Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== tx.date ||
      typeof tx.created !== 'string' || !Number.isFinite(Date.parse(tx.created)) ||
      !accounts.has(tx.account) || typeof tx.note !== 'string' || tx.note.length > 160 ||
      (tx.type === 'expense' && !categoryIds.has(tx.category)) ||
      (tx.type === 'transfer' && (!accounts.has(tx.to) || tx.to === tx.account))) fail();
  }
  return state;
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
