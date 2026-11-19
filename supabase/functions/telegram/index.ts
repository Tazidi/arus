const base = Deno.env.get('SUPABASE_URL')!;
const publicKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
const webhookSecret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET');
const origins = (Deno.env.get('ARUS_ORIGINS') || '').split(',').map(value => value.trim()).filter(Boolean);

type Account = { id: string; name: string; provider?: string; customProvider?: string; type: string; opening: number; savings?: boolean };
type Category = { id: string; name: string; archived?: boolean; icon?: string; aliases?: string[] };
type Group = { id?: string; name?: string; archived?: boolean; categories: Category[] };
type Transaction = { type: 'income' | 'expense' | 'transfer'; date: string; amount: number; account: string;
  to?: string; salary?: boolean };
type Ledger = { state: { accounts: Account[]; groups: Group[]; transactions: Transaction[] } };
type Message = { chat: { type: string; id: number }; text?: string; message_id: number;
  reply_to_message?: { text?: string; from?: { is_bot?: boolean } } };
type Callback = { id: string; data?: string; message?: Message };
type Update = { update_id: number; message?: Message; callback_query?: Callback };
type Reply = Record<string, unknown>;

async function call<T>(path: string, options: RequestInit = {}, key = serviceKey, bearer = key): Promise<T> {
  const response = await fetch(base + path, {
    ...options, headers: { apikey: key, Authorization: 'Bearer ' + bearer, 'Content-Type': 'application/json', ...options.headers },
  });
  if (!response.ok) throw new Error('Backend request failed with status ' + response.status);
  const payload = await response.text();
  return payload ? JSON.parse(payload) as T : undefined as T;
}
const rest = <T>(path: string, options?: RequestInit) => call<T>('/rest/v1/' + path, options);
const rpc = <T>(name: string, payload: Reply) => rest<T>('rpc/' + name, { method: 'POST', body: JSON.stringify(payload) });
const equals = (value: string) => 'eq.' + encodeURIComponent(value);
const nowDate = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Jakarta' }).format(new Date());
const normalize = (value: string) => value.trim().toLocaleLowerCase('id').replace(/\s+/g, ' ');
async function hash(code: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index++) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}
async function send(method: string, payload: Reply) {
  if (!botToken) throw new Error('Telegram is not configured.');
  const response = await fetch('https://api.telegram.org/bot' + botToken + '/' + method, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error('Telegram API status ' + response.status);
}
const say = (chat: string, text: string, options: Reply = {}) =>
  send('sendMessage', { chat_id: chat, text, protect_content: true, ...options });
const menu = { reply_markup: { keyboard: [
  [{ text: 'Catat Pengeluaran' }, { text: 'Catat Pemasukan' }],
  [{ text: 'Catat Gaji' }, { text: 'Catat Transfer' }],
  [{ text: 'Saldo' }, { text: 'Ringkasan' }],
], resize_keyboard: true, is_persistent: true } };
const money = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const labels = { income: 'Pemasukan', expense: 'Pengeluaran', transfer: 'Transfer' };
const amountPattern = String.raw`(\d{1,13}(?:[.,]\d{1,3})?k|\d{1,13}|\d{1,3}(?:\.\d{3}){1,4})`;
const middleAmount = new RegExp('^(.{1,80}?) ' + amountPattern + ' (.{1,80})$', 'iu');
const trailingAmount = new RegExp('^(.{3,161}) ' + amountPattern + '$', 'iu');
const shortAmount = new RegExp('^(.{1,80}) ' + amountPattern + '$', 'iu');
const leadingAmount = new RegExp('^' + amountPattern + ' (.{1,80})$', 'iu');
const amountOnly = new RegExp('^' + amountPattern + '$', 'iu');
const parseAmount = (amount: string) => {
  if (!amountOnly.test(amount)) return 0;
  const abbreviated = /^([0-9]+)(?:[.,]([0-9]+))?k$/i.exec(amount);
  const value = abbreviated ? Number(abbreviated[1]) * 1000 + Number((abbreviated[2] || '').padEnd(3, '0')) :
    Number(amount.replaceAll('.', ''));
  return Number.isSafeInteger(value) && value >= 1 && value <= 1e12 ? value : 0;
};
const activeCategories = (state: Ledger['state']) =>
  state.groups.filter(group => !group.archived).flatMap(group => group.categories).filter(category => !category.archived);

function findAccount(input: string, available: Account[]) {
  const name = normalize(input);
  if (!name) return;
  const exact = available.filter(account => normalize(account.name) === name);
  const matches = exact.length ? exact : available.filter(account => normalize(account.provider || '') === name ||
    normalize(account.customProvider || '') === name || (account.type === 'cash' && ['cash', 'tunai'].includes(name)));
  return matches.length === 1 ? matches[0] : undefined;
}

function expenseDetails(input: string, state: Ledger['state']) {
  const categories = activeCategories(state);
  const middle = middleAmount.exec(input);
  const trailing = trailingAmount.exec(input);
  const candidates: { note: string; account: string; amount: string }[] = [];
  if (middle) candidates.push({ note: middle[1], account: middle[3], amount: middle[2] });
  if (trailing) {
    for (let split = trailing[1].indexOf(' '); split >= 0; split = trailing[1].indexOf(' ', split + 1)) {
      if (split <= 80 && trailing[1].length - split - 1 <= 80) {
        candidates.push({ note: trailing[1].slice(0, split), account: trailing[1].slice(split + 1), amount: trailing[2] });
      }
    }
  }
  const matches = new Map<string, Omit<Details, 'type'>>();
  for (const candidate of candidates) {
    const amount = parseAmount(candidate.amount);
    const account = findAccount(candidate.account, state.accounts);
    if (!amount || !account) continue;
    const { category, suggested } = classifyCategory(candidate.note, categories);
    matches.set(JSON.stringify([account.id, normalize(candidate.note), amount]), { category, suggested, account, amount, note: candidate.note });
  }
  const resolved = [...matches.values()].filter(match => match.category);
  if (resolved.length) return resolved.length === 1 ? resolved[0] : undefined;
  if (matches.size === 1) return matches.values().next().value;
}

function classifyCategory(input: string, categories: Category[]) {
  const literal = normalize(input);
  const exact = categories.filter(category => normalize(category.name) === literal);
  if (exact.length) return { category: exact.length === 1 ? exact[0] : undefined };
  const aliases = categories.filter(category => category.aliases?.some(alias => normalize(alias) === literal));
  return { suggested: aliases.length === 1 ? aliases[0] : undefined };
}

type Details = { type: Transaction['type']; account: Account; amount: number; category?: Category; suggested?: Category; note?: string; to?: Account; salary?: boolean };
function transactionDetails(input: string, state: Ledger['state'], original: string): Details | undefined {
  const income = /^(pemasukan|gaji) (.+)$/u.exec(input);
  if (income) {
    const end = shortAmount.exec(income[2]);
    const start = leadingAmount.exec(income[2]);
    const matches = new Map<string, Details>();
    for (const [name, raw] of [end && [end[1], end[2]], start && [start[2], start[1]]].filter(pair => pair !== null)) {
      const account = findAccount(name, state.accounts);
      const amount = parseAmount(raw);
      if (amount && account) matches.set(JSON.stringify([account.id, amount]), { type: 'income', account, amount, salary: income[1] === 'gaji' });
    }
    return matches.size === 1 ? matches.values().next().value : undefined;
  }
  if (input.startsWith('transfer ')) {
    const parts = input.slice('transfer '.length).split('>');
    if (parts.length !== 2) return;
    const destination = shortAmount.exec(parts[1].trim());
    if (!destination) return;
    const account = findAccount(parts[0], state.accounts);
    const to = findAccount(destination[1], state.accounts);
    const amount = parseAmount(destination[2]);
    if (account && to && account.id !== to.id && amount) return { type: 'transfer', account, to, amount };
    return;
  }
  const salary = input.endsWith(' dari gaji');
  const expense = expenseDetails(salary ? original.slice(0, -' dari gaji'.length) : original, state);
  if (expense) return { ...expense, type: 'expense', salary };
}

const entryTypes = {
  'catat pengeluaran': { type: 'expense', salary: false },
  'catat pemasukan': { type: 'income', salary: false },
  'catat gaji': { type: 'income', salary: true },
  'catat transfer': { type: 'transfer', salary: false },
} as const;

const welcomeText = 'Cara mencatat di Arus\n' +
  '1. Tekan Catat Pengeluaran dan pilih kategori.\n' +
  '2. Ketik nominal, misalnya 12k (Rp12.000) atau 12.5k (Rp12.500).\n' +
  '3. Pilih rekening jika ada beberapa. Cek pratinjau dan tekan Simpan.\n\n' +
  'Untuk pemasukan, gaji, atau transfer, pilih tombol yang sesuai. Bisa juga langsung ketik: makan tunai 12.5k.\n' +
  'Ketik /menu untuk melihat menu atau /batal untuk membatalkan pencatatan.';

function guidedInput(input: string, reply: Message['reply_to_message']) {
  if (!reply?.from?.is_bot) return input;
  const legacy = /^Catat (pemasukan|gaji|transfer) di Arus$/.exec(reply.text?.split('\n')[0] || '');
  return legacy && !input.startsWith(legacy[1] + ' ') ? legacy[1] + ' ' + input : input;
}

function balanceReport(state: Ledger['state'], today: string) {
  const balances = new Map(state.accounts.map(account => [account.id, account.opening]));
  for (const tx of state.transactions) {
    if (tx.date > today || !balances.has(tx.account)) continue;
    balances.set(tx.account, balances.get(tx.account)! + (tx.type === 'income' ? tx.amount : -tx.amount));
    if (tx.type === 'transfer' && tx.to && balances.has(tx.to)) balances.set(tx.to, balances.get(tx.to)! + tx.amount);
  }
  const total = Array.from(balances.values()).reduce((sum, amount) => sum + amount, 0);
  const lines = state.accounts.slice(0, 25).map(account => account.name + ' · ' + money.format(balances.get(account.id)!));
  if (state.accounts.length > 25) lines.push('+' + (state.accounts.length - 25) + ' rekening lainnya.');
  return 'Total saldo ' + money.format(total) + '\n\n' + (lines.join('\n') || 'Belum ada rekening.');
}

function monthReport(state: Ledger['state'], today: string) {
  const month = today.slice(0, 7);
  let income = 0, expenses = 0, salary = 0, spentFromSalary = 0;
  for (const tx of state.transactions) {
    if (!tx.date.startsWith(month)) continue;
    if (tx.type === 'income') { income += tx.amount; if (tx.salary) salary += tx.amount; }
    if (tx.type === 'expense') { expenses += tx.amount; if (tx.salary) spentFromSalary += tx.amount; }
  }
  const period = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' })
    .format(new Date(today + 'T12:00:00+07:00'));
  return ['Ringkasan ' + period, 'Pemasukan ' + money.format(income), 'Pengeluaran ' + money.format(expenses),
    'Arus kas bersih ' + money.format(income - expenses), 'Sisa gaji ' + money.format(salary - spentFromSalary)].join('\n');
}

type CategoryOption = { id: string; label: string; suggested?: true };
type PreviewDraft = { type: Transaction['type']; salary: boolean; needsCategory?: boolean; categoryOptions?: CategoryOption[] };
const categoryPageSize = 8;
const pendingButtons = (updateId: string) => [
  [{ text: 'Simpan untuk ditinjau', callback_data: 'review:' + updateId }],
  [{ text: 'Batal', callback_data: 'cancel:' + updateId }],
];

function previewKeyboard(updateId: string, draft: PreviewDraft) {
  const keyboard = draft.needsCategory ? pendingButtons(updateId) :
    [[{ text: 'Simpan', callback_data: 'save:' + updateId }, { text: 'Batal', callback_data: 'cancel:' + updateId }]];
  if (draft.categoryOptions?.length) {
    keyboard.unshift([{ text: 'Pilih kategori', callback_data: 'categories:' + updateId + ':0' }]);
  }
  const suggestion = draft.categoryOptions?.findIndex(option => option.suggested) ?? -1;
  if (suggestion >= 0) keyboard.unshift([{
    text: 'Simpan sebagai ' + draft.categoryOptions![suggestion].label,
    callback_data: 'category:' + updateId + ':' + suggestion,
  }]);
  if (draft.type === 'expense') keyboard.push([{
    text: 'Dari gaji: ' + (draft.salary ? 'Ya' : 'Tidak'),
    callback_data: 'salary:' + updateId + ':' + (draft.salary ? '0' : '1'),
  }]);
  return { inline_keyboard: keyboard };
}

const previewPath = (chat: string, updateId: string) =>
  'telegram_drafts?chat_id=' + equals(chat) + '&update_id=' + equals(updateId) + '&expires_at=gt.' +
  encodeURIComponent(new Date().toISOString());

async function handleCallback(query: Callback, revision: string) {
  if (query.message?.chat.type !== 'private') return;
  if (query.data?.startsWith('flow:')) return handleFlowCallback(query, revision);
  const action = /^(save|cancel|review|categories|category|salary):([0-9]{1,20})(?::([0-9]{1,8}))?$/.exec(query.data || '');
  if (!action) return;
  const [, kind, updateId, argument] = action;
  if ((kind === 'categories' || kind === 'category' || kind === 'salary') !== (argument !== undefined)) return;
  const chat = String(query.message.chat.id);
  const respond = (text?: string) => send('answerCallbackQuery', { callback_query_id: query.id, text }).catch(() => {});
  if (kind === 'categories' || kind === 'salary') {
    const path = previewPath(chat, updateId);
    const [row] = await rest<{ transaction_data: PreviewDraft }[]>(path + '&select=transaction_data');
    const draft = row?.transaction_data;
    if (kind === 'salary') {
      if (draft?.type !== 'expense' || (argument !== '0' && argument !== '1')) {
        return respond('Pratinjau sudah tidak tersedia.');
      }
      const next = { ...draft, salary: argument === '1' };
      const rows = await rest<unknown[]>(path, { method: 'PATCH', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ transaction_data: next }) });
      if (!rows.length) return respond('Pratinjau sudah tidak tersedia.');
      await respond(next.salary ? 'Ditandai sebagai pengeluaran dari gaji.' : 'Ditandai sebagai pengeluaran biasa.');
      await send('editMessageReplyMarkup', { chat_id: chat, message_id: query.message.message_id,
        reply_markup: previewKeyboard(updateId, next) }).catch(() => {});
      return;
    }
    const options = draft?.categoryOptions;
    if (!options?.length) return respond('Daftar kategori sudah tidak tersedia.');
    const page = Number(argument);
    const start = page * categoryPageSize;
    if (start >= options.length) return respond('Halaman kategori tidak tersedia.');
    const keyboard = options.slice(start, start + categoryPageSize).map((item, index) => [
      { text: 'Simpan: ' + item.label, callback_data: 'category:' + updateId + ':' + (start + index) },
    ]);
    const pages = [];
    if (page > 0) pages.push({ text: '‹ Sebelumnya', callback_data: 'categories:' + updateId + ':' + (page - 1) });
    if (start + categoryPageSize < options.length) pages.push({ text: 'Berikutnya ›', callback_data: 'categories:' + updateId + ':' + (page + 1) });
    if (pages.length) keyboard.push(pages);
    keyboard.push(...pendingButtons(updateId));
    await respond();
    await send('editMessageReplyMarkup', { chat_id: chat, message_id: query.message.message_id,
      reply_markup: { inline_keyboard: keyboard } }).catch(() => {});
    return;
  }
  const outcome = await rpc<'saved' | 'saved_review' | 'category_changed' | 'unlinked' | 'expired' | 'invalid' | 'cancelled'>('arus_confirm_telegram_v2', {
    input_chat: chat, input_update: updateId, should_save: kind !== 'cancel',
    category_index: kind === 'category' ? Number(argument) : null,
  });
  const label = { saved: 'Transaksi tersimpan di Arus.', saved_review: 'Tersimpan. Pilih kategorinya di Arus → Transaksi → Perlu kategori.',
    category_changed: 'Kategori sudah berubah. Pilih kategori lain atau simpan untuk ditinjau.',
    unlinked: 'Hubungkan bot melalui pengaturan Arus.',
    expired: 'Pratinjau sudah kedaluwarsa. Kirim transaksi lagi.', invalid: 'Rekening atau kategori berubah. Kirim transaksi lagi.',
    cancelled: 'Pencatatan dibatalkan.' }[outcome];
  await respond(label);
  if (outcome !== 'category_changed') {
    await send('editMessageText', { chat_id: chat, message_id: query.message.message_id, text: label }).catch(() => {});
  }
}
type FlowStage = 'category' | 'amount' | 'account' | 'destination' | 'preview';
type Flow = {
  id: string; revision: string; stage: FlowStage; type: Transaction['type']; salary: boolean;
  options?: CategoryOption[]; category?: string; note?: string; amount?: number; account?: string; to?: string;
};
type FlowRow = { transaction_data: Flow; expires_at: string };
const amountReply = { reply_markup: { force_reply: true, input_field_placeholder: 'Contoh: 12.5k' } };
const flowPath = (chat: string) => 'telegram_drafts?chat_id=' + equals(chat) + '&update_id=eq.flow';
const flowRevision = (flow: Flow) => '&' + encodeURIComponent('transaction_data->>revision') + '=' + equals(flow.revision);
const flowExpiry = () => new Date(Date.now() + 15 * 60 * 1000).toISOString();
const flowExpired = 'Langkah ini sudah berubah atau kedaluwarsa. Pilih menu untuk mulai lagi.';

async function loadFlowRow(chat: string, includeExpired = false) {
  const [row] = await rest<FlowRow[]>(flowPath(chat) + '&select=transaction_data,expires_at' +
    (includeExpired ? '' : '&expires_at=gt.' + encodeURIComponent(new Date().toISOString())));
  return row;
}

async function loadFlow(chat: string) {
  return (await loadFlowRow(chat))?.transaction_data;
}

async function changeFlow(chat: string, current: Flow, next: Flow) {
  const rows = await rest<FlowRow[]>(flowPath(chat) + flowRevision(current), {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ transaction_data: next, expires_at: flowExpiry() }),
  });
  return !!rows.length;
}

async function cancelFlow(chat: string, flow: Flow) {
  const rows = await rest<FlowRow[]>(flowPath(chat) + flowRevision(flow), {
    method: 'DELETE', headers: { Prefer: 'return=representation' },
  });
  if (!rows.length) return;
  if (flow.stage === 'preview') {
    await rpc('arus_confirm_telegram_v2', {
      input_chat: chat, input_update: flow.id, should_save: false, category_index: null,
    });
  }
}

function categoryOptions(state: Ledger['state'], suggested?: Category): CategoryOption[] {
  const active = activeCategories(state);
  const duplicates = new Map<string, number>();
  for (const item of active) duplicates.set(normalize(item.name), (duplicates.get(normalize(item.name)) || 0) + 1);
  return state.groups.filter(group => !group.archived).flatMap(group =>
    group.categories.filter(item => !item.archived).map(item => {
      const builtIn = (group.id === 'needs' && group.name === 'Kebutuhan') || (group.id === 'wants' && group.name === 'Keinginan') ||
        ((group.id === 'other' || group.id?.startsWith('general-')) && group.name === 'Lainnya');
      const groupLabel = group.name && (duplicates.get(normalize(item.name)) || 0) > 1 ?
        ' · ' + (builtIn ? 'Kategori bawaan' : group.name) : '';
      const label = (item.icon ? item.icon + ' ' : '') + item.name + groupLabel;
      return { id: item.id, label: label.slice(0, 80), ...(item.id === suggested?.id && { suggested: true as const }) };
    })).sort((left, right) => Number(!!right.suggested) - Number(!!left.suggested));
}
const accountOptions = (accounts: Account[]) => accounts.map(account => ({ id: account.id, label: account.name }));
const flowData = (flow: Flow, verb: string, index = 0) => ['flow', flow.id, flow.stage, verb, index].join(':');

function flowKeyboard(flow: Flow, page: number) {
  const options = flow.options || [];
  const start = page * categoryPageSize;
  const rows = options.slice(start, start + categoryPageSize).map((option, index) => [
    { text: option.label, callback_data: flowData(flow, 'pick', start + index) },
  ]);
  const navigation = [];
  if (page > 0) navigation.push({ text: '‹ Sebelumnya', callback_data: flowData(flow, 'page', page - 1) });
  if (start + categoryPageSize < options.length) navigation.push({ text: 'Berikutnya ›', callback_data: flowData(flow, 'page', page + 1) });
  if (navigation.length) rows.push(navigation);
  if (flow.stage === 'category') rows.push([{ text: 'Perlu kategori', callback_data: flowData(flow, 'skip') }]);
  rows.push([{ text: 'Batal', callback_data: flowData(flow, 'stop') }]);
  return { inline_keyboard: rows };
}

async function showFlow(chat: string, flow: Flow, state: Ledger['state']) {
  if (flow.stage === 'amount') {
    const category = activeCategories(state).find(item => item.id === flow.category);
    const title = category?.name || (flow.salary ? 'Gaji' : labels[flow.type]);
    return say(chat, title + '\nKetik nominal, misalnya 12k atau 12.5k.', amountReply);
  }
  if (flow.stage === 'preview') {
    const account = state.accounts.find(item => item.id === flow.account);
    const to = state.accounts.find(item => item.id === flow.to);
    const category = activeCategories(state).find(item => item.id === flow.category);
    if (!account || !flow.amount || (flow.type === 'transfer' && !to) || (flow.category && !category)) {
      return say(chat, 'Rekening atau kategori berubah. Pilih menu untuk mencatat lagi.', menu);
    }
    return previewTransaction(chat, flow.id, { type: flow.type, salary: flow.salary,
      amount: flow.amount, account, to, category, note: flow.note || category?.name || labels[flow.type] }, state);
  }
  const suggestion = flow.stage === 'category' && flow.options?.find(option => option.suggested);
  const prompt = flow.stage === 'category'
    ? suggestion ? 'Saran untuk “' + flow.note + '”: ' + suggestion.label + '. Pilih kategori.' : 'Pilih kategori pengeluaran.'
    :
    flow.stage === 'destination' ? 'Pilih rekening tujuan.' :
    flow.type === 'transfer' ? 'Pilih rekening asal.' : 'Pilih rekening.';
  return say(chat, (flow.amount ? money.format(flow.amount) + '\n' : '') + prompt, { reply_markup: flowKeyboard(flow, 0) });
}

async function startFlow(chat: string, id: string, entry: Pick<Flow, 'type' | 'salary'>, state: Ledger['state'], suggestion?: { category: Category; note: string }) {
  if (!state.accounts.length) return say(chat, 'Tambahkan rekening di Arus dulu, lalu pilih menu ini lagi.', menu);
  if (entry.type === 'transfer' && state.accounts.length < 2) {
    return say(chat, 'Transfer membutuhkan dua rekening yang berbeda. Tambahkan rekening di Arus.', menu);
  }
  const row = await loadFlowRow(chat, true);
  const current = row?.transaction_data;
  if (current && Date.parse(row.expires_at) > Date.now() && Number(current.revision) >= Number(id)) {
    if (current.id === id) await showFlow(chat, current, state);
    return;
  }
  const flow: Flow = { ...entry, id, revision: id, stage: entry.type === 'expense' ? 'category' : 'amount',
    ...(entry.type === 'expense' && { options: categoryOptions(state, suggestion?.category), note: suggestion?.note }) };
  if (current) {
    if (!await changeFlow(chat, current, flow)) return say(chat, flowExpired, menu);
  } else {
    const rows = await rest<FlowRow[]>('telegram_drafts', {
      method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify({ chat_id: chat, update_id: 'flow', transaction_data: flow, expires_at: flowExpiry() }),
    });
    if (!rows.length) return say(chat, flowExpired, menu);
  }
  await showFlow(chat, flow, state);
}

async function handleFlowCallback(query: Callback, revision: string) {
  const message = query.message;
  if (!message) return;
  const action = /^flow:([0-9]{1,20}):(category|account|destination):(pick|page|skip|stop):([0-9]{1,8})$/.exec(query.data || '');
  const respond = (text?: string) => send('answerCallbackQuery', { callback_query_id: query.id, text }).catch(() => {});
  if (!action) return respond(flowExpired);
  const [, id, stage, verb, rawIndex] = action;
  const chat = String(message.chat.id);
  const flow = await loadFlow(chat);
  if (!flow || flow.id !== id || Number(revision) < Number(flow.revision)) return respond(flowExpired);
  if (flow.revision !== revision && flow.stage !== stage) return respond(flowExpired);
  const index = Number(rawIndex);
  if (verb === 'page') {
    if (index * categoryPageSize >= (flow.options?.length || 0)) return respond('Halaman tidak tersedia.');
    await respond();
    await send('editMessageReplyMarkup', { chat_id: chat, message_id: message.message_id,
      reply_markup: flowKeyboard(flow, index) }).catch(() => {});
    return;
  }
  if (verb === 'stop') {
    await cancelFlow(chat, flow);
    await respond('Pencatatan dibatalkan.');
    return;
  }
  const [link] = await rest<{ user_id: string }[]>('telegram_links?chat_id=' + equals(chat) + '&select=user_id');
  if (!link) return respond('Hubungkan bot melalui pengaturan Arus.');
  const [ledger] = await rest<Ledger[]>('ledgers?user_id=' + equals(link.user_id) + '&select=state');
  if (!ledger) return respond(flowExpired);
  const state = ledger.state;
  if (flow.revision === revision) {
    await respond();
    return showFlow(chat, flow, state);
  }
  const option = flow.options?.[index];
  if ((verb === 'pick' && !option) || (verb === 'skip' && stage !== 'category')) return respond(flowExpired);
  const next: Flow = { ...flow, revision, stage: 'preview', options: undefined };
  if (stage === 'category') {
    next.stage = 'amount';
    next.category = verb === 'skip' ? '' : option?.id;
  } else if (stage === 'account') {
    next.account = option!.id;
    if (flow.type === 'transfer') {
      const destinations = state.accounts.filter(account => account.id !== next.account);
      if (!destinations.length) return respond('Rekening tujuan tidak tersedia.');
      if (destinations.length === 1) next.to = destinations[0].id;
      else {
        next.stage = 'destination';
        next.options = accountOptions(destinations);
      }
    }
  } else if (stage === 'destination') {
    next.to = option!.id;
  }
  if (!await changeFlow(chat, flow, next)) return respond(flowExpired);
  await respond();
  await showFlow(chat, next, state);
}

async function handleUpdate(update: Update) {
  if (!Number.isSafeInteger(update.update_id)) return;
  if (update.callback_query) return handleCallback(update.callback_query, String(update.update_id));
  const message = update.message;
  if (message?.chat.type !== 'private' || !message.text) return;
  const chat = String(message.chat.id);
  const text = message.text.trim();
  const command = /^\/start(?:@\w+)?(?: ([a-f0-9]{32}))?$/.exec(text);
  if (command?.[1]) {
    const linked = await rpc<boolean>('arus_link_telegram', { input_hash: await hash(command[1]), input_chat: chat });
    if (linked) await say(chat, 'Telegram terhubung ke Arus.\n\n' + welcomeText, menu);
    else await say(chat, 'Tautan tidak berlaku atau Telegram ini sudah terhubung ke akun lain.');
    return;
  }
  const [link] = await rest<{ user_id: string }[]>('telegram_links?chat_id=' + equals(chat) + '&select=user_id');
  if (!link) {
    await say(chat, 'Untuk mulai, buka Arus → Pengaturan → Hubungkan Telegram. Buka tautan yang muncul, lalu tekan Start di chat ini.');
    return;
  }
  const input = normalize(text).replace(/^\/([a-z]+)(?:@\w+)?(?= |$)/, '$1');
  if (['start', 'help', 'bantuan'].includes(input)) return say(chat, welcomeText, menu);
  if (input === 'menu') return say(chat, 'Pilih jenis transaksi atau lihat laporan.', menu);
  if (input === 'batal' || input === 'cancel') {
    const flow = await loadFlow(chat);
    if (flow) await cancelFlow(chat, flow);
    return say(chat, 'Pencatatan dibatalkan. Pilih menu untuk mulai lagi.', menu);
  }
  const [ledger] = await rest<Ledger[]>('ledgers?user_id=' + equals(link.user_id) + '&select=state');
  if (!ledger) {
    await say(chat, 'Buka Arus untuk menyiapkan rekening dan kategori.');
    return;
  }
  const state = ledger.state;
  if (input === 'saldo') return say(chat, balanceReport(state, nowDate()));
  if (input === 'ringkasan') return say(chat, monthReport(state, nowDate()));
  const updateId = String(update.update_id);
  const entry = Object.hasOwn(entryTypes, input) ? entryTypes[input as keyof typeof entryTypes] : undefined;
  if (entry) return startFlow(chat, updateId, entry, state);
  const details = transactionDetails(guidedInput(input, message.reply_to_message), state, text.replace(/\s+/g, ' '));
  if (details) return previewTransaction(chat, updateId, details, state);

  const flow = await loadFlow(chat);
  if (flow?.stage === 'amount' && Number(updateId) > Number(flow.revision)) {
    const amount = parseAmount(input);
    if (!amount) return say(chat, 'Nominal belum valid. Ketik misalnya 12k, 12.5k, atau 12.500.', amountReply);
    if (!state.accounts.length) return say(chat, 'Tambahkan rekening di Arus dulu, lalu coba lagi.', menu);
    const next: Flow = { ...flow, amount, revision: updateId, stage: 'account', options: accountOptions(state.accounts) };
    if (flow.type !== 'transfer' && state.accounts.length === 1) {
      next.stage = 'preview';
      next.account = state.accounts[0].id;
      delete next.options;
    }
    if (await changeFlow(chat, flow, next)) await showFlow(chat, next, state);
    return;
  }
  if (flow?.revision === updateId && (flow.stage === 'account' || flow.stage === 'preview')) return showFlow(chat, flow, state);
  if ((!flow || flow.stage === 'category' || flow.stage === 'preview') && text.length <= 80 && !text.startsWith('/')) {
    const match = classifyCategory(text, activeCategories(state));
    const category = match.category || match.suggested;
    if (category) return startFlow(chat, updateId, entryTypes['catat pengeluaran'], state, { category, note: text });
  }
  if (flow && flow.stage !== 'preview') {
    return say(chat, 'Gunakan tombol di langkah sebelumnya, atau ketik /batal untuk mulai ulang.');
  }
  await say(chat, 'Transaksi belum dikenali. Pilih menu pencatatan atau ketik contoh seperti makan tunai 12.5k.', menu);
}

async function previewTransaction(chat: string, updateId: string, details: Details, state: Ledger['state']) {
  const { type, account, category, suggested, to, amount, note, salary } = details;
  const label = type === 'income' && salary ? 'Gaji' : labels[type];
  const needsCategory = type === 'expense' && !category;
  const options = needsCategory ? categoryOptions(state, suggested) : [];
  const next = { id: 'telegram-' + updateId, type, account: account.id, category: category?.id || '', amount,
    date: nowDate(), created: new Date().toISOString(), to: to?.id || '', note: note || label, salary: !!salary,
    ...(needsCategory && { needsCategory: true, categoryOptions: options }) };
  await rest('telegram_drafts?chat_id=' + equals(chat) + '&expires_at=lt.' + encodeURIComponent(next.created), { method: 'DELETE' });
  await rest('telegram_drafts', {
    method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({ chat_id: chat, update_id: updateId, transaction_data: next }),
  });
  const preview = [label + ' · ' + money.format(amount), to ? account.name + ' → ' + to.name : 'Rekening: ' + account.name];
  if (category) preview.push('Kategori: ' + category.name);
  if (needsCategory) preview.push('Catatan: ' + note, suggested ? 'Saran kategori: ' + suggested.name : 'Kategori belum dikenali.');
  await say(chat, preview.join('\n'), { reply_markup: previewKeyboard(updateId, next) });
}

Deno.serve(async request => {
  const origin = request.headers.get('origin') || '';
  const fromApp = origins.includes(origin);
  const cors = fromApp ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type', Vary: 'Origin' } : {};
  const reply = (body: Reply, status = 200) => Response.json(body, { status, headers: cors });
  if (request.method === 'OPTIONS' && fromApp) return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return reply({ message: 'Method not allowed.' }, 405);
  try {
    if (fromApp) {
      const bearer = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1];
      if (!bearer) return reply({ message: 'Masuk kembali ke Arus.' }, 401);
      const user = await call<{ id: string }>('/auth/v1/user', {}, publicKey, bearer).catch(() => null);
      if (!user?.id) return reply({ message: 'Sesi telah berakhir.' }, 401);
      if (!botToken || !webhookSecret) return reply({ message: 'Bot belum dikonfigurasi.' }, 503);
      const { action } = await request.json();
      if (action === 'status') {
        const links = await rest<unknown[]>('telegram_links?user_id=' + equals(user.id) + '&select=chat_id');
        return reply({ connected: !!links.length });
      }
      if (action === 'unlink') {
        await rpc('arus_unlink_telegram', { input_user: user.id });
        return reply({ connected: false });
      }
      if (action === 'link') {
        const code = crypto.randomUUID().replaceAll('-', '');
        await rest('telegram_codes', {
          method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({ user_id: user.id, code_hash: await hash(code), expires_at: new Date(Date.now() + 600000).toISOString() }),
        });
        return reply({ code });
      }
      return reply({ message: 'Aksi tidak dikenali.' }, 400);
    }
    const secret = request.headers.get('x-telegram-bot-api-secret-token') || '';
    if (!webhookSecret || !safeEqual(secret, webhookSecret)) return reply({ message: 'Forbidden.' }, 403);
    await handleUpdate(await request.json());
    return reply({ ok: true });
  } catch (error) {
    console.error(error instanceof Error ? error.name : 'Unhandled error');
    return reply({ message: 'Telegram belum dapat menyelesaikan permintaan.' }, 500);
  }
});
