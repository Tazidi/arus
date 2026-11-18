import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { initial, today } from '../dist/ledger.mjs';
import { categoryName, setPreference } from '../dist/preferences.mjs';
import { dashboard } from '../dist/views.mjs';

test('existing category IDs appear directly in spending and groups filter the subtotal', () => {
  const state = initial();
  const date = today();
  const list = [
    { type: 'expense', category: 'food', amount: 375000, date },
    { type: 'expense', category: 'fun', amount: 95000, date },
  ];
  const summary = group => dashboard(state, list, date.slice(0, 7), { group, income: true, expense: true })
    .match(/<section class="card breakdown">[\s\S]*?<\/section>/)[0];

  assert.match(summary(''), /data-action="category-transactions" data-id="food"/);
  assert.match(summary(''), /data-action="category-transactions" data-id="fun"/);
  assert.match(summary(''), /breakdown-total">Rp\s470\.000/);
  assert.doesNotMatch(summary('needs'), /data-action="category-transactions" data-id="fun"/);
  assert.match(summary('needs'), /breakdown-total">Rp\s375\.000/);
});

test('English localizes default categories without rewriting custom or stored names', () => {
  const preset = initial().groups[0].categories[0];
  try {
    setPreference('language', 'en');
    assert.equal(categoryName(preset), 'Food');
    assert.equal(categoryName({ ...preset, name: 'Makan siang' }), 'Makan siang');
    assert.equal(categoryName({ id: 'custom', name: 'Makan' }), 'Makan');
    assert.equal(preset.name, 'Makan');
  } finally {
    setPreference('language', 'id');
  }
});

test('system theme follows the browser and a manual choice overrides it', () => {
  const events = {};
  const media = { matches: false, addEventListener: (_, callback) => { events.media = callback; } };
  const dataset = {};
  const themeColor = {};
  runInNewContext(readFileSync(new URL('../dist/theme.js', import.meta.url), 'utf8'), {
    document: { documentElement: { dataset }, querySelector: () => themeColor },
    localStorage: { getItem: () => 'system' },
    matchMedia: () => media,
    window: { addEventListener: (name, callback) => { events[name] = callback; } },
  });
  assert.equal(dataset.theme, 'light');
  media.matches = true;
  events.media();
  assert.equal(dataset.theme, 'dark');
  assert.equal(themeColor.content, '#1b1b19');
  events['arus:theme']({ detail: 'light' });
  events.media();
  assert.equal(dataset.theme, 'light');
  assert.equal(themeColor.content, '#e8dfce');
});

test('cash flow shows weeks for the selected month or all months in its year', () => {
  const state = initial();
  state.transactions = [
    { type: 'income', date: '2028-02-29', amount: 275000 },
    { type: 'expense', date: '2028-05-20', amount: 135000 },
    { type: 'income', date: '2027-05-01', amount: 980000 },
  ];
  const february = state.transactions.slice(0, 1);
  const graph = monthly => dashboard(state, february, '2028-02', { monthly, income: true, expense: true })
    .match(/<section class="card flow">[\s\S]*?<\/section>/)[0];

  const weekly = graph(false);
  assert.equal((weekly.match(/data-action="chart-range"/g) || []).length, 5);
  assert.match(weekly, /data-month="2028-02"\s+data-start="29" data-end="29"\s+aria-label="Tanggal 29, pemasukan Rp\s275\.000/);
  assert.doesNotMatch(weekly, /2028-05|Harian/);

  const monthly = graph(true);
  assert.equal((monthly.match(/data-action="chart-range"/g) || []).length, 12);
  assert.match(monthly, /data-month="2028-02"\s+aria-current="date"/);
  assert.match(monthly, /data-month="2028-05"\s+aria-label="Mei 2028, pemasukan Rp\s0, pengeluaran Rp\s135\.000/);
  assert.doesNotMatch(monthly, /data-start=|980\.000/);
});
