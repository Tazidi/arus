const base = Deno.env.get('SUPABASE_URL')!;
const publicKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
const webhookSecret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET');
const origins = (Deno.env.get('ARUS_ORIGINS') || '').split(',').map(value => value.trim()).filter(Boolean);

type Account = { id: string; name: string; provider?: string; type: string };
type Category = { id: string; name: string; archived?: boolean };
type Group = { archived?: boolean; categories: Category[] };
type Ledger = { state: { accounts: Account[]; groups: Group[] } };
type Message = { chat: { type: string; id: number }; text?: string; message_id: number };
type Callback = { id: string; data?: string; message?: Message };
type Update = { update_id: number; message?: Message; callback_query?: Callback };
type Reply = Record<string, unknown>;

async function call<T>(path: string, options: RequestInit = {}, key = serviceKey, bearer = key): Promise<T> {
  const response = await fetch(base + path, {
    ...options, headers: { apikey: key, Authorization: 'Bearer ' + bearer, 'Content-Type': 'application/json', ...options.headers },
  });
  if (!response.ok) throw new Error('Backend request failed with status ' + response.status);
  return response.status === 204 ? undefined as T : await response.json() as T;
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
const howTo = 'Kirim kategori, nominal rupiah, dan rekening. Contoh: makan 25000 cash. Nama kategori dan rekening mengikuti data di Arus.';

async function handleCallback(query: Callback) {
  if (query.message?.chat.type !== 'private') return;
  const action = /^(save|cancel):(\d{1,20})$/.exec(query.data || '');
  if (!action) return;
  const chat = String(query.message.chat.id);
  const outcome = await rpc<'saved' | 'unlinked' | 'expired' | 'invalid' | 'cancelled'>('arus_confirm_telegram', {
    input_chat: chat, input_update: action[2], should_save: action[1] === 'save',
  });
  const label = { saved: 'Pengeluaran tersimpan di Arus.', unlinked: 'Hubungkan bot melalui pengaturan Arus.',
    expired: 'Pratinjau sudah kedaluwarsa. Kirim transaksi lagi.', invalid: 'Rekening atau kategori berubah. Kirim transaksi lagi.',
    cancelled: 'Pencatatan dibatalkan.' }[outcome];
  await send('answerCallbackQuery', { callback_query_id: query.id, text: label }).catch(() => {});
  await send('editMessageText', { chat_id: chat, message_id: query.message.message_id, text: label }).catch(() => {});
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
    await say(chat, linked ? 'Telegram terhubung ke Arus. ' + howTo : 'Tautan tidak berlaku atau Telegram ini sudah terhubung ke akun lain.');
    return;
  }
  const [link] = await rest<{ user_id: string }[]>('telegram_links?chat_id=' + equals(chat) + '&select=user_id');
  if (!link) {
    await say(chat, 'Hubungkan Telegram dari Pengaturan akun Arus terlebih dahulu.');
    return;
  }
  const parsed = /^(.{1,80}?)\s+([0-9]{1,13})\s+(.{1,80})$/u.exec(text);
  if (!parsed && text.startsWith('/')) {
    await say(chat, howTo);
    return;
  }
  const amount = parsed ? Number(parsed[2]) : 0;
  if (!parsed || amount < 1 || amount > 1e12) {
    await say(chat, howTo);
    return;
  }
  const [ledger] = await rest<Ledger[]>('ledgers?user_id=' + equals(link.user_id) + '&select=state');
  if (!ledger) {
    await say(chat, 'Buka Arus untuk menyiapkan rekening dan kategori.');
    return;
  }
  const actual = normalize(parsed[3]);
  const exact = ledger.state.accounts.filter(account => normalize(account.name) === actual);
  const accounts = exact.length ? exact : ledger.state.accounts.filter(account =>
    normalize(account.provider || '') === actual || (account.type === 'cash' && actual === 'cash'));
  const categoryMatches = ledger.state.groups.filter(group => !group.archived).flatMap(group => group.categories)
    .filter(category => !category.archived && normalize(category.name) === normalize(parsed[1]));
  if (accounts.length !== 1 || categoryMatches.length !== 1) {
    await say(chat, 'Rekening atau kategori tidak ditemukan secara unik. Gunakan nama yang tercantum di Arus dan pastikan nama kategori tidak ganda.');
    return;
  }
  const [account] = accounts;
  const [category] = categoryMatches;
  const updateId = String(update.update_id);
  const next = { id: 'telegram-' + updateId, type: 'expense', account: account.id, category: category.id, amount,
    date: nowDate(), created: new Date().toISOString(), to: '', note: category.name, salary: false };
  await rest('telegram_drafts?chat_id=' + equals(chat) + '&expires_at=lt.' + encodeURIComponent(next.created), { method: 'DELETE' });
  await rest('telegram_drafts', {
    method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({ chat_id: chat, update_id: updateId, transaction_data: next }),
  });
  const formatted = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount);
  await say(chat, 'Simpan pengeluaran ini?\n' + category.name + ' · ' + formatted + '\nRekening: ' + account.name, {
    reply_markup: { inline_keyboard: [[{ text: 'Simpan', callback_data: 'save:' + updateId }, { text: 'Batal', callback_data: 'cancel:' + updateId }]] },
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
