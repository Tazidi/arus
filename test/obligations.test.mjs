import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backup, parseBackup } from '../dist/exports.mjs';
import { balances, initial, obligationProgress, recordObligationPayment, validate } from '../dist/ledger.mjs';
import { merge } from '../dist/storage.mjs';
import { billScheduleBody } from '../dist/views.mjs';

const bill = { id: 'internet', kind: 'bill', name: 'Internet', amount: 300000, firstDue: '2028-01-31', archived: false };
const loan = { id: 'loan', kind: 'loan', name: 'Cicilan', amount: 1000000, balance: 2500000, firstDue: '2028-01-31', archived: false };
const payment = (id, amount, date) => ({
  id, amount, date, account: 'cash', category: 'bills', note: 'Pembayaran', created: date + 'T02:00:00Z',
});
function ledger(item) {
  const state = initial();
  state.accounts.push({ id: 'cash', name: 'Tunai', type: 'cash', opening: 4000000, savings: false });
  if (item) state.obligations.push(item);
  return state;
}

test('monthly bills keep their due day, use shorter months correctly, and reopen after deleting a payment', () => {
  const state = ledger(bill);
  recordObligationPayment(state, bill.id, '2028-01', payment('jan', 320000, '2028-01-30'));
  assert.equal(obligationProgress(bill, state.transactions).due, '2028-02-29');
  assert.throws(() => recordObligationPayment(state, bill.id, '2028-01', payment('duplicate', 300000, '2028-01-31')), /Periode tagihan/);
  recordObligationPayment(state, bill.id, '2028-02', payment('feb', 300000, '2028-02-29'));
  assert.equal(obligationProgress(bill, state.transactions).due, '2028-03-31');
  assert.equal(balances(validate(state), '2028-02-29').cash, 3380000);
  state.transactions.shift();
  assert.equal(obligationProgress(bill, state.transactions).due, '2028-01-31');
});

test('a recorded payment reduces only the account selected to pay the bill', () => {
  const state = ledger(bill);
  state.accounts.push({ id: 'bank', name: 'Bank', type: 'bank', opening: 500000, savings: false });
  recordObligationPayment(state, bill.id, '2028-01', { ...payment('bank-pay', 300000, '2028-01-30'), account: 'bank' });
  assert.deepEqual(balances(validate(state), '2028-01-30'), { cash: 4000000, bank: 200000 });
});

test('partial and extra loan payments update the next installment and retain linked expenses', () => {
  const state = ledger(loan);
  recordObligationPayment(state, loan.id, undefined, payment('part', 600000, '2028-01-30'));
  assert.deepEqual(obligationProgress(loan, state.transactions), { paid: 600000, remaining: 1900000, due: '2028-01-31', amount: 400000 });
  recordObligationPayment(state, loan.id, undefined, payment('extra', 1500000, '2028-02-01'));
  assert.equal(obligationProgress(loan, state.transactions).due, '2028-03-31');
  assert.throws(() => recordObligationPayment(state, loan.id, undefined, payment('excess', 400001, '2028-02-02')), /melebihi sisa pinjaman/);
  recordObligationPayment(state, loan.id, undefined, payment('final', 400000, '2028-02-02'));
  assert.equal(obligationProgress(loan, state.transactions).remaining, 0);
  assert.equal(balances(validate(state), '2028-02-02').cash, 1500000);
  assert.deepEqual(parseBackup(backup(state)), state);
});

test('legacy data merges with new schedules without losing purchases or allowing duplicate bill payments', () => {
  const base = ledger();
  delete base.obligations;
  const local = structuredClone(base);
  local.obligations = [bill];
  recordObligationPayment(local, bill.id, '2028-01', payment('jan', 300000, '2028-01-30'));
  const remote = structuredClone(base);
  remote.transactions.push({ ...payment('purchase', 10000, '2028-01-30'), type: 'expense', category: 'food' });
  const merged = merge(base, local, remote);
  assert.deepEqual(merged.obligations, [bill]);
  assert.equal(merged.transactions.length, 2);
  assert.deepEqual(parseBackup(backup(base)).obligations, []);

  const concurrent = { ...remote, obligations: [bill] };
  recordObligationPayment(concurrent, bill.id, '2028-01', payment('other-jan', 300000, '2028-01-31'));
  assert.throws(() => merge(base, local, concurrent), error => error.conflict === true);
});

test('a three-month schedule uses custom amounts, preserves actual payments, and ends after the last month', () => {
  const plan = { ...bill, duration: 3, monthlyAmounts: { '2028-02': 350000, '2028-03': 270000 } };
  const state = ledger(plan);

  assert.equal(obligationProgress(plan, state.transactions).remainingPeriods, 3);
  recordObligationPayment(state, plan.id, '2028-01', payment('first', 300000, '2028-01-31'));
  assert.equal(obligationProgress(plan, state.transactions).amount, 350000);
  recordObligationPayment(state, plan.id, '2028-02', payment('second', 360000, '2028-02-21'));
  assert.equal(obligationProgress(plan, state.transactions).remainingPeriods, 1);
  assert.match(billScheduleBody(plan, state.transactions, 0), /Februari 2028[\s\S]*?350\.000[\s\S]*?360\.000/);
  recordObligationPayment(state, plan.id, '2028-03', payment('third', 270000, '2028-03-31'));
  assert.deepEqual(obligationProgress(plan, state.transactions), { paid: 930000, due: '', amount: 0, remainingPeriods: 0 });
  assert.throws(() => recordObligationPayment(state, plan.id, '2028-04', payment('outside', 270000, '2028-04-30')), /Periode tagihan/);
  assert.deepEqual(parseBackup(backup(state)), state);

  const shortened = { ...plan, duration: 2, monthlyAmounts: {} };
  assert.throws(() => validate({ ...state, obligations: [shortened] }), /Struktur data/);
  state.transactions.pop();
  assert.equal(obligationProgress(plan, validate(state).transactions).due, '2028-03-31');
});
