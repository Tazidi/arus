import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';
import { balances, initial, validate } from '../dist/ledger.mjs';
import { dashboard, table } from '../dist/views.mjs';

test('Telegram confirms known or unknown purchases and leaves ambiguous entries unsaved', async () => {
  const previousFetch = globalThis.fetch;
  const previousDeno = globalThis.Deno;
  const state = initial();
  state.accounts.push({ id: 'cash', name: 'Tunai', type: 'cash', opening: 100000, savings: false });
  const drafts = [];
  const sent = [];
  const confirmations = [];
  let handler;
  let flow;
  globalThis.Deno = {
    env: { get: key => ({
      SUPABASE_URL: 'https://db.example.test', SUPABASE_SERVICE_ROLE_KEY: 'service-fixture',
      TELEGRAM_BOT_TOKEN: 'test-bot', TELEGRAM_WEBHOOK_SECRET: 'test-webhook',
    })[key] },
    serve: action => { handler = action; },
  };
  globalThis.fetch = async (target, options) => {
    const url = new URL(target);
    const body = options.body ? JSON.parse(options.body) : undefined;
    if (url.hostname === 'api.telegram.org') {
      sent.push({ method: url.pathname.split('/').at(-1), ...body });
      return Response.json({ ok: true });
    }
    if (url.pathname.endsWith('/telegram_links')) return Response.json([{ user_id: 'demo' }]);
    if (url.pathname.endsWith('/ledgers')) return Response.json([{ state }]);
    if (url.pathname.endsWith('/telegram_drafts')) {
      if (body?.update_id === 'flow') {
        if (flow) return Response.json([]);
        flow = body;
        return Response.json([flow]);
      }
      if (url.searchParams.get('update_id') === 'eq.flow') {
        if (!flow) return Response.json([]);
        if (!options.method) return Response.json([flow]);
        if (url.searchParams.get('transaction_data->>revision') !== 'eq.' + flow.transaction_data.revision) return Response.json([]);
        const before = flow;
        flow = options.method === 'PATCH' ? { ...flow, ...body } : undefined;
        return Response.json([flow || before]);
      }
      if (options.method === 'POST') drafts.push(body);
      const matching = drafts.filter(item => 'eq.' + item.update_id === url.searchParams.get('update_id'));
      if (options.method === 'PATCH') {
        for (const item of matching) item.transaction_data = body.transaction_data;
        return Response.json(matching);
      }
      if (!options.method) return Response.json(matching);
      return new Response(null, { status: 204 });
    }
    if (url.pathname.endsWith('/arus_confirm_telegram_v2')) {
      confirmations.push(body);
      return Response.json(body.category_index === null ? 'saved_review' : 'saved');
    }
    throw new Error('Unexpected test request: ' + url.pathname);
  };
  try {
    const source = await readFile(new URL('../supabase/functions/telegram/index.ts', import.meta.url), 'utf8');
    await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
    const chat = { type: 'private', id: 42 };
    const update = async payload => {
      const result = await handler(new Request('https://db.example.test/webhook', {
        method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'test-webhook' }, body: JSON.stringify(payload),
      }));
      assert.equal(result.status, 200);
    };
    const message = (id, text) => update({ update_id: id, message: { chat, text } });
    let callbackUpdateId = 100;
    const choose = data => update({ update_id: ++callbackUpdateId, callback_query: { id: 'callback', data, message: { chat, message_id: 24 } } });

    await message(1, 'Kopi Susu tunai 25.000 dari gaji');
    const pending = drafts[0].transaction_data;
    assert.equal(pending.note, 'Kopi Susu');
    assert.equal(pending.needsCategory, true);
    assert.equal(pending.category, '');
    assert.equal(pending.salary, true);
    assert.equal(pending.amount, 25000);
    assert.equal(confirmations.length, 0);
    assert.ok(sent.at(-1).reply_markup.inline_keyboard.flat().some(button => button.callback_data === 'review:1'));

    await choose('categories:1:0');
    const category = sent.at(-1).reply_markup.inline_keyboard.flat().find(button => button.text.startsWith('Simpan:') && button.text.includes('Makan & Minum'));
    assert.ok(category);
    await choose(category.callback_data);
    assert.equal(pending.categoryOptions[confirmations.at(-1).category_index].id, 'food');
    await choose('review:1');
    assert.deepEqual(confirmations.at(-1), { input_chat: '42', input_update: '1', should_save: true, category_index: null });

    await message(2, 'Servis 75.000 tunai');
    assert.equal(drafts.at(-1).transaction_data.note, 'Servis');
    await message(3, 'Makan & Minum tunai 25.000');
    assert.equal(drafts.at(-1).transaction_data.category, 'food');
    assert.equal(drafts.at(-1).transaction_data.needsCategory, undefined);
    state.accounts.push({ id: 'cash-2', name: 'Tunai', type: 'cash', opening: 100000, savings: false });
    await message(4, 'kopi tunai 25.000');
    assert.equal(drafts.length, 3);

    state.accounts[1].name = 'Tabungan';
    await message(5, 'Makan tunai 12.5K');
    assert.equal(drafts.at(-1).transaction_data.amount, 12500);
    await message(6, 'pemasukan tunai 12k');
    assert.equal(drafts.at(-1).transaction_data.amount, 12000);
    await message(7, 'pemasukan tunai 12.0001k');
    assert.equal(drafts.length, 5);

    await message(8, '/start');
    assert.match(sent.at(-1).text, /Pilih rekening jika ada beberapa/);
    await message(9, 'Catat Pengeluaran');
    const food = sent.at(-1).reply_markup.inline_keyboard.flat().find(button => button.text.includes('Makan & Minum'));
    assert.ok(food);
    await choose(food.callback_data);
    assert.equal(sent.at(-1).reply_markup.force_reply, true);
    await message(++callbackUpdateId, '12,5k');
    const cash = sent.at(-1).reply_markup.inline_keyboard[0][0];
    assert.equal(cash.text, 'Tunai');
    await choose(cash.callback_data);
    const salary = sent.at(-1).reply_markup.inline_keyboard.flat().find(button => button.text === 'Dari gaji: Tidak');
    assert.equal(drafts.at(-1).transaction_data.category, 'food');
    assert.equal(drafts.at(-1).transaction_data.amount, 12500);
    assert.equal(drafts.at(-1).transaction_data.salary, false);
    await choose(salary.callback_data);
    assert.equal(drafts.at(-1).transaction_data.salary, true);
    assert.ok(sent.at(-1).reply_markup.inline_keyboard.flat().some(button => button.text === 'Dari gaji: Ya'));
    const preview = sent.at(-1).reply_markup.inline_keyboard[0][0];
    assert.equal(preview.callback_data, 'save:9');
    await choose(preview.callback_data);
    assert.equal(confirmations.at(-1).input_update, '9');
    await choose(cash.callback_data);
    assert.equal(sent.at(-1).method, 'answerCallbackQuery');
    assert.match(sent.at(-1).text, /kedaluwarsa/);

    await message(++callbackUpdateId, 'Catat Transfer');
    await message(++callbackUpdateId, '12k');
    const sourceButton = sent.at(-1).reply_markup.inline_keyboard[0][0];
    await choose(sourceButton.callback_data);
    assert.match(sent.at(-1).text, /Tunai → Tabungan/);
    assert.equal(drafts.at(-1).transaction_data.account, 'cash');
    assert.equal(drafts.at(-1).transaction_data.to, 'cash-2');
    assert.equal(drafts.at(-1).transaction_data.amount, 12000);
    await message(++callbackUpdateId, '/batal');
    assert.equal(flow, undefined);
    assert.equal(confirmations.at(-1).should_save, false);

    state.accounts.push({ id: 'third', name: 'Dompet', type: 'cash', opening: 100000, savings: false });
    await message(++callbackUpdateId, 'Catat Transfer');
    await message(++callbackUpdateId, '12k');
    await choose(sent.at(-1).reply_markup.inline_keyboard[0][0].callback_data);
    const buttons = sent.at(-1).reply_markup.inline_keyboard.flat();
    assert.ok(buttons.some(button => button.text === 'Tabungan'));
    assert.ok(buttons.some(button => button.text === 'Dompet'));
    assert.ok(!buttons.some(button => button.text === 'Tunai'));
    await choose(buttons.find(button => button.text === 'Dompet').callback_data);
    assert.equal(drafts.at(-1).transaction_data.to, 'third');

    state.accounts.splice(1);
    await message(++callbackUpdateId, 'Catat Pemasukan');
    await message(++callbackUpdateId, '12.5k');
    assert.match(sent.at(-1).text, /Rekening: Tunai/);
    assert.equal(sent.at(-1).reply_markup.inline_keyboard[0][0].text, 'Simpan');

    await message(++callbackUpdateId, 'jajan tunai 12k');
    const suggestion = drafts.at(-1).transaction_data;
    assert.equal(suggestion.note, 'jajan');
    assert.equal(suggestion.category, '');
    assert.equal(suggestion.categoryOptions[0].id, 'food');
    assert.match(sent.at(-1).text, /Saran kategori: Makan & Minum/);
    const suggestedButton = sent.at(-1).reply_markup.inline_keyboard[0][0];
    assert.match(suggestedButton.text, /Simpan sebagai .*Makan & Minum/);
    await choose(suggestedButton.callback_data);
    assert.equal(confirmations.at(-1).category_index, 0);

    await message(++callbackUpdateId, 'jajan');
    assert.match(sent.at(-1).text, /Saran untuk “jajan”: .*Makan & Minum/);
    await choose(sent.at(-1).reply_markup.inline_keyboard[0][0].callback_data);
    await message(++callbackUpdateId, '12500');
    assert.equal(drafts.at(-1).transaction_data.note, 'jajan');
    assert.equal(drafts.at(-1).transaction_data.category, 'food');
  } finally {
    globalThis.fetch = previousFetch;
    if (previousDeno === undefined) delete globalThis.Deno;
    else globalThis.Deno = previousDeno;
  }
});

test('pending expenses count in balances and show up in the uncategorized breakdown', () => {
  const state = initial();
  state.accounts.push({ id: 'cash', name: 'Tunai', type: 'cash', opening: 100000, savings: false });
  const expense = { id: 'telegram-1', type: 'expense', account: 'cash', category: '', needsCategory: true,
    amount: 25000, note: 'Kopi', date: '2026-10-10', created: '2026-10-10T12:00:00Z' };
  state.transactions.push(expense);
  assert.equal(balances(validate(state), expense.date).cash, 75000);
  assert.match(table(state, state.transactions), /category-review">Perlu kategori/);
  const summary = dashboard(state, state.transactions, '2026-10', { income: true, expense: true });
  assert.match(summary, /data-id=":review"/);
  assert.match(summary, /breakdown-total">Rp\s25\.000/);
  assert.throws(() => validate({ ...state, transactions: [{ ...expense, needsCategory: undefined }] }), /Struktur data/);
  expense.category = 'food';
  delete expense.needsCategory;
  validate(state);
  assert.doesNotMatch(table(state, state.transactions), /category-review/);
});
