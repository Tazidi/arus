import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backup, csv, parseBackup, xlsx } from '../dist/exports.mjs';
import { balances, recordBalanceAdjustment, formatAmount, initial, parseAmount, totals, validate } from '../dist/ledger.mjs';
import { hasChanges, merge } from '../dist/storage.mjs';

const account = (id, opening, savings = false) => ({ id, name: id, opening, savings, type: 'cash', provider: '' });
const tx = (id, type, amount, fields = {}) => ({ id, type, amount, account: 'cash', category: '', to: '',
  date: '2026-11-01', created: '2026-11-01T07:00:00Z', salary: false, note: '', ...fields });
const sample = () => ({ ...initial(), accounts: [account('cash', 0), account('savings', 0, true)],
  transactions: [tx('salary', 'income', 8000000, { salary: true }), tx('food', 'expense', 5000000, { category: 'food', salary: true }),
    tx('transfer', 'transfer', 2000000, { to: 'savings' })] });

test('transfer moves money and preserves accumulated balance and salary remainder', () => {
  const ledger = validate(sample());
  assert.deepEqual(balances(ledger, '2026-11-30'), { cash: 1000000, savings: 2000000 });
  assert.deepEqual(totals(ledger.transactions), { income: 8000000, expense: 5000000, salary: 8000000, salaryExpense: 5000000 });
});

test('backup restores every area and rejects invalid references', () => {
  const original = sample();
  assert.deepEqual(parseBackup(backup(original)), original);
  original.transactions[2].to = 'missing';
  assert.throws(() => parseBackup(backup(original)), /tidak valid/);
});

test('custom providers and logos survive backup and cloud merges', () => {
  const base = sample();
  const edited = structuredClone(base);
  Object.assign(edited.accounts[0], { type: 'bank', customProvider: 'Bank Saya',
    logo: 'data:image/png;base64,iVBORw0KGgo=' });
  assert.deepEqual(parseBackup(backup(merge(base, edited, base))), edited);
  edited.accounts[0].logo = 'https://example.com/logo.png';
  assert.throws(() => validate(edited), /tidak valid/);
  edited.accounts[0].logo = 'data:image/svg+xml;base64,c3Zn';
  assert.throws(() => validate(edited), /tidak valid/);
});

test('rupiah input groups thousands and parses amounts without losing digits', () => {
  assert.equal(formatAmount('10000'), '10.000');
  assert.equal(formatAmount('1.0000'), '10.000');
  assert.equal(formatAmount('-0010000'), '-10.000');
  assert.equal(parseAmount('10.000'), 10000);
  assert.equal(parseAmount('-10.000', -1e12), -10000);
  assert.throws(() => parseAmount('-10.000'));
  assert.throws(() => parseAmount('10,50'));
  assert.throws(() => parseAmount(''));
});

test('merge preserves independent changes, detects conflicts and accepts sync retries', () => {
  const base = sample();
  const local = structuredClone(base);
  local.transactions[0].amount -= 300;
  const remote = structuredClone(base);
  remote.transactions.push(tx('remote', 'expense', 25000, { category: 'food' }));
  const result = merge(base, local, remote);
  assert.equal(result.transactions[0].amount, 7999700);
  assert.equal(result.transactions.at(-1).id, 'remote');
  assert.deepEqual(merge(base, local, result), result);
  assert.equal(hasChanges({ state: result, base: structuredClone(result) }), false);
  remote.transactions[0].amount += 100;
  assert.throws(() => merge(base, local, remote), { conflict: true });
  assert.equal(merge(base, local, remote, true).transactions[0].amount, 7999700);
});

test('exports literal notes and packages three worksheets', async () => {
  const ledger = sample();
  ledger.transactions[0].note = '=HYPERLINK("example")';
  assert.match(csv(ledger, ledger.transactions), /'=HYPERLINK/);
  const bytes = Buffer.from(await xlsx(ledger, ledger.transactions, 'November').arrayBuffer());
  const entries = new Map();
  for (let offset = 0; bytes.readUInt32LE(offset) === 0x04034b50;) {
    const nameLength = bytes.readUInt16LE(offset + 26);
    const fileSize = bytes.readUInt32LE(offset + 18);
    const nameStart = offset + 30;
    const fileStart = nameStart + nameLength;
    entries.set(bytes.toString('utf8', nameStart, fileStart), bytes.toString('utf8', fileStart, fileStart + fileSize));
    offset = fileStart + fileSize;
  }
  assert.equal(entries.size, 7);
  assert.match(entries.get('xl/workbook.xml'), /Ringkasan.*Rekening.*Transaksi/);
  assert.match(entries.get('xl/worksheets/sheet3.xml'), /<v>8000000<\/v>/);
  assert.match(entries.get('xl/worksheets/sheet3.xml'), /=HYPERLINK\(&quot;example&quot;\)/);
});

test('setting a current balance records the signed difference without changing opening balance or cash flow', () => {
  const state = sample();
  const date = '2028-01-31';
  const before = balances(state, date).cash;
  const baseline = totals(state.transactions);
  recordBalanceAdjustment(state, 'cash', 250000, before, date);
  assert.equal(state.transactions.at(-1).note, 'Penyesuaian saldo');
  assert.equal(state.transactions.at(-1).amount, 250000 - before);
  assert.equal(state.transactions.at(-1).type, 'adjustment');
  assert.equal(balances(state, date).cash, 250000);
  assert.equal(state.accounts[0].opening, 0);

  assert.throws(() => recordBalanceAdjustment(state, 'cash', 125000, before, date), /Saldo berubah/);
  recordBalanceAdjustment(state, 'cash', 125000, 250000, date);
  assert.equal(state.transactions.at(-1).amount, -125000);
  const count = state.transactions.length;
  recordBalanceAdjustment(state, 'cash', 125000, 125000, date);
  assert.equal(state.transactions.length, count);
  assert.equal(balances(state, date).cash, 125000);
  assert.deepEqual(totals(state.transactions), baseline);
  assert.deepEqual(parseBackup(backup(state)), state);
});

test('concurrent corrections to the same balance use conflict resolution rather than adding both differences', () => {
  const base = sample();
  const date = '2028-01-31';
  const current = balances(base, date).cash;
  const local = structuredClone(base);
  const remote = structuredClone(base);
  recordBalanceAdjustment(local, 'cash', 50000, current, date);
  recordBalanceAdjustment(remote, 'cash', 60000, current, date);
  assert.throws(() => merge(base, local, remote), error => error.conflict === true);
  assert.equal(balances(merge(base, local, remote, true), date).cash, 50000);
});
