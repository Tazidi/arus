const base = Deno.env.get('SUPABASE_URL')!;
const publicKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
const webhookSecret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET');
const origins = (Deno.env.get('ARUS_ORIGINS') || '').split(',').map(value => value.trim()).filter(Boolean);

type Account = { id: string; name: string; provider?: string; customProvider?: string; type: string; opening: number; savings?: boolean };
type Category = { id: string; name: string; archived?: boolean };
type Group = { name?: string; archived?: boolean; categories: Category[] };
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
const amountPattern = String.raw`(\d{1,13}|\d{1,3}(?:\.\d{3}){1,4})`;
const middleAmount = new RegExp('^(.{1,80}?) ' + amountPattern + ' (.{1,80})$', 'u');
const trailingAmount = new RegExp('^(.{3,161}) ' + amountPattern + '$', 'u');
const shortAmount = new RegExp('^(.{1,80}) ' + amountPattern + '$', 'u');
const leadingAmount = new RegExp('^' + amountPattern + ' (.{1,80})$', 'u');
const parseAmount = (amount: string) => {
  const value = Number(amount.replaceAll('.', ''));
  return value >= 1 && value <= 1e12 ? value : 0;
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
    const matching = categories.filter(category => normalize(category.name) === normalize(candidate.note));
    const category = matching.length === 1 ? matching[0] : undefined;
    matches.set(JSON.stringify([account.id, normalize(candidate.note), amount]), { category, account, amount, note: candidate.note });
  }
  const resolved = [...matches.values()].filter(match => match.category);
  if (resolved.length) return resolved.length === 1 ? resolved[0] : undefined;
  if (matches.size === 1) return matches.values().next().value;
}

type Details = { type: Transaction['type']; account: Account; amount: number; category?: Category; note?: string; to?: Account; salary?: boolean };
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

const guideLabels = { 'catat pengeluaran': 'pengeluaran', 'catat pemasukan': 'pemasukan',
  'catat gaji': 'gaji', 'catat transfer': 'transfer' } as const;
const guides = {
  pengeluaran: 'Balas dengan kategori, rekening, dan nominal. Contoh: makan tunai 25.000.\nUntuk pengeluaran dari gaji, tambahkan “dari gaji” di akhir.',
  pemasukan: 'Balas dengan rekening tujuan dan nominal. Contoh: BCA 500.000.',
  gaji: 'Balas dengan rekening tujuan dan nominal. Contoh: BCA 8.000.000. Transaksi ini dihitung dalam sisa gaji.',
  transfer: 'Balas dengan rekening asal > rekening tujuan, lalu nominal. Contoh: BCA > tunai 100.000.',
};
const guideTitle = (kind: string) => 'Catat ' + kind + ' di Arus';
function guidedInput(input: string, reply: Message['reply_to_message']) {
  if (!reply?.from?.is_bot) return input;
  const title = reply.text?.split('\n')[0];
  const guide = Object.keys(guides).find(kind => title === guideTitle(kind));
  if (guide && guide !== 'pengeluaran' && !input.startsWith(guide + ' ')) return guide + ' ' + input;
  return input;
}
const menuText = 'Pilih menu di bawah untuk mencatat transaksi atau melihat laporan. Ketik /menu untuk menampilkan menu lagi.';
const names = (items: { name: string }[]) => items.length ? items.slice(0, 12).map(item => item.name).join(', ') +
  (items.length > 12 ? ' (+' + (items.length - 12) + ' lainnya)' : '') : 'Belum ada';

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

type CategoryOption = { id: string; label: string };
const categoryPageSize = 8;
const pendingButtons = (updateId: string) => [
  [{ text: 'Simpan untuk ditinjau', callback_data: 'review:' + updateId }],
  [{ text: 'Batal', callback_data: 'cancel:' + updateId }],
];

async function handleCallback(query: Callback) {
  if (query.message?.chat.type !== 'private') return;
  const action = /^(save|cancel|review|categories|category):([0-9]{1,20})(?::([0-9]{1,8}))?$/.exec(query.data || '');
  if (!action) return;
  const [, kind, updateId, argument] = action;
  if ((kind === 'categories' || kind === 'category') !== (argument !== undefined)) return;
  const chat = String(query.message.chat.id);
  const respond = (text?: string) => send('answerCallbackQuery', { callback_query_id: query.id, text }).catch(() => {});
  if (kind === 'categories') {
    const [draft] = await rest<{ transaction_data: { categoryOptions?: CategoryOption[] } }[]>(
      'telegram_drafts?chat_id=' + equals(chat) + '&update_id=' + equals(updateId) + '&expires_at=gt.' +
      encodeURIComponent(new Date().toISOString()) + '&select=transaction_data');
    const options = draft?.transaction_data.categoryOptions;
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
async function handleUpdate(update: Update) {
  if (update.callback_query) return handleCallback(update.callback_query);
  const message = update.message;
  if (message?.chat.type !== 'private' || !message.text || !Number.isSafeInteger(update.update_id)) return;
  const chat = String(message.chat.id);
  const text = message.text.trim();
  const command = /^\/start(?:@\w+)?(?: ([a-f0-9]{32}))?$/.exec(text);
  if (command?.[1]) {
    const linked = await rpc<boolean>('arus_link_telegram', { input_hash: await hash(command[1]), input_chat: chat });
    if (linked) await say(chat, 'Telegram terhubung ke Arus.\n' + menuText, menu);
    else await say(chat, 'Tautan tidak berlaku atau Telegram ini sudah terhubung ke akun lain.');
    return;
  }
  const [link] = await rest<{ user_id: string }[]>('telegram_links?chat_id=' + equals(chat) + '&select=user_id');
  if (!link) {
    await say(chat, 'Hubungkan Telegram dari Pengaturan akun Arus terlebih dahulu.');
    return;
  }
  const input = normalize(text).replace(/^\/([a-z]+)(?:@\w+)?(?= |$)/, '$1');
  if (['start', 'menu', 'help', 'bantuan'].includes(input)) return say(chat, menuText, menu);
  const [ledger] = await rest<Ledger[]>('ledgers?user_id=' + equals(link.user_id) + '&select=state');
  if (!ledger) {
    await say(chat, 'Buka Arus untuk menyiapkan rekening dan kategori.');
    return;
  }
  const state = ledger.state;
  if (input === 'saldo') return say(chat, balanceReport(state, nowDate()));
  if (input === 'ringkasan') return say(chat, monthReport(state, nowDate()));
  const guide = Object.hasOwn(guideLabels, input) ? guideLabels[input as keyof typeof guideLabels] : undefined;
  if (guide) return say(chat, guideTitle(guide) + '\n\n' + guides[guide] + '\n\nRekening: ' + names(state.accounts) +
    (guide === 'pengeluaran' ? '\nKategori: ' + names(activeCategories(state)) : ''),
    { reply_markup: { force_reply: true, input_field_placeholder: 'Masukkan detail transaksi' } });
  const details = transactionDetails(guidedInput(input, message.reply_to_message), state, text.replace(/\s+/g, ' '));
  if (!details) {
    await say(chat, 'Transaksi belum dikenali. Pilih tombol sesuai jenis transaksi untuk melihat format dan nama rekening.', menu);
    return;
  }
  const { type, account, category, to, amount, note, salary } = details;
  const updateId = String(update.update_id);
  const label = type === 'income' && salary ? 'Gaji' : labels[type];
  const needsCategory = type === 'expense' && !category;
  const categoryOptions = needsCategory ? state.groups.filter(group => !group.archived).flatMap(group =>
    group.categories.filter(item => !item.archived)
      .map(item => ({ id: item.id, label: (group.name ? item.name + ' · ' + group.name : item.name).slice(0, 80) })))
    .sort((left, right) => left.label.localeCompare(right.label, 'id')) : [];
  const next = { id: 'telegram-' + updateId, type, account: account.id, category: category?.id || '', amount,
    date: nowDate(), created: new Date().toISOString(), to: to?.id || '', note: note || label, salary: !!salary,
    ...(needsCategory && { needsCategory: true, categoryOptions }) };
  await rest('telegram_drafts?chat_id=' + equals(chat) + '&expires_at=lt.' + encodeURIComponent(next.created), { method: 'DELETE' });
  await rest('telegram_drafts', {
    method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({ chat_id: chat, update_id: updateId, transaction_data: next }),
  });
  const preview = [label + ' · ' + money.format(amount), to ? account.name + ' → ' + to.name : 'Rekening: ' + account.name];
  if (category) preview.push('Kategori: ' + category.name);
  if (needsCategory) preview.push('Catatan: ' + note, 'Kategori belum dikenali.');
  if (salary && type === 'expense') preview.push('Dari gaji');
  const keyboard = needsCategory ? pendingButtons(updateId) :
    [[{ text: 'Simpan', callback_data: 'save:' + updateId }, { text: 'Batal', callback_data: 'cancel:' + updateId }]];
  if (categoryOptions.length) keyboard.unshift([{ text: 'Pilih kategori', callback_data: 'categories:' + updateId + ':0' }]);
  await say(chat, preview.join('\n'), {
    reply_markup: { inline_keyboard: keyboard },
  });
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
