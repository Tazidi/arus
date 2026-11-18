import { balances, categories, newest, types, validate, totals } from './ledger.mjs';

export function backup(state) {
  return JSON.stringify({ format: 'arus-money-tracker', version: 1, savedAt: new Date().toISOString(), state }, null, 2);
}
export function parseBackup(text) {
  const value = JSON.parse(text);
  if (value?.format !== 'arus-money-tracker' || value.version !== 1) throw new Error('File ini bukan backup Arus versi 1.');
  return validate(value.state);
}
export function download(value, name, type) {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const button = Object.assign(document.createElement('a'), { href: url, download: name });
  button.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export function rows(state, list) {
  const accounts = new Map(state.accounts.map(account => [account.id, account]));
  const names = new Map(categories(state).map(category => [category.id, category]));
  return [['Tanggal', 'Jenis', 'Nominal (IDR)', 'Rekening', 'Rekening tujuan', 'Kelompok', 'Kategori', 'Gaji / dari gaji', 'Catatan'],
    ...[...list].sort(newest).map(tx => {
      const category = names.get(tx.category);
      return [tx.date, types[tx.type], tx.amount, accounts.get(tx.account)?.name || '', accounts.get(tx.to)?.name || '',
        category?.group.name || '', category?.name || '', tx.salary ? 'Ya' : '', tx.note];
    })];
}
export function csv(state, list) {
  const cell = value => {
    let content = String(value);
    if (typeof value === 'string' && /^[\s]*[=+\-@\t\r\n]/.test(content)) content = "'" + content;
    return '"' + content.replaceAll('"', '""') + '"';
  };
  return '\ufeff' + rows(state, list).map(row => row.map(cell).join(',')).join('\r\n');
}

const escapeXml = value => String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '')
  .replace(/[<>&"']/g, character => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character]);
const xml = content => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + content;
const sheetNamespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relNamespace = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const packageNamespace = 'http://schemas.openxmlformats.org/package/2006/relationships';
function columnName(index) {
  let name = '';
  for (let value = index + 1; value; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + (value - 1) % 26) + name;
  return name;
}
function worksheet(data) {
  const content = data.map((row, index) => '<row r="' + (index + 1) + '">' + row.map((value, column) => {
    const address = columnName(column) + (index + 1);
    if (typeof value === 'number') return '<c r="' + address + '"><v>' + value + '</v></c>';
    return '<c r="' + address + '" t="inlineStr"><is><t xml:space="preserve">' + escapeXml(value) + '</t></is></c>';
  }).join('') + '</row>').join('');
  return xml('<worksheet xmlns="' + sheetNamespace + '"><sheetData>' + content + '</sheetData></worksheet>');
}
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value;
});
function zip(files) {
  const encoder = new TextEncoder();
  const parts = [];
  const directory = [];
  let offset = 0;
  let directoryLength = 0;
  const fields = (length, values) => {
    const bytes = new Uint8Array(length);
    const data = new DataView(bytes.buffer);
    for (const [position, value, short] of values) {
      if (short) data.setUint16(position, value, true);
      else data.setUint32(position, value, true);
    }
    return bytes;
  };
  for (const [path, content] of Object.entries(files)) {
    const name = encoder.encode(path);
    const bytes = encoder.encode(content);
    let crc = 0xffffffff;
    for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
    crc ^= 0xffffffff;
    const header = fields(30, [[0, 0x04034b50], [4, 20, true], [12, 33, true], [14, crc], [18, bytes.length], [22, bytes.length], [26, name.length, true]]);
    const entry = fields(46, [[0, 0x02014b50], [4, 20, true], [6, 20, true], [14, 33, true], [16, crc],
      [20, bytes.length], [24, bytes.length], [28, name.length, true], [42, offset]]);
    parts.push(header, name, bytes);
    directory.push(entry, name);
    offset += header.length + name.length + bytes.length;
    directoryLength += entry.length + name.length;
  }
  const count = directory.length / 2;
  const end = fields(22, [[0, 0x06054b50], [8, count, true], [10, count, true], [12, directoryLength], [16, offset]]);
  return new Blob([...parts, ...directory, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
export function xlsx(state, list, label) {
  const values = totals(list);
  const accountBalances = balances(state);
  const sheets = {
    Ringkasan: [['Periode', label], ['Pemasukan', values.income], ['Pengeluaran', values.expense],
      ['Arus kas bersih', values.income - values.expense], ['Sisa gaji', values.salary - values.salaryExpense]],
    Rekening: [['Nama', 'Tipe', 'Saldo awal', 'Saldo saat ini', 'Tabungan'],
      ...state.accounts.map(account => [account.name, account.type, account.opening, accountBalances[account.id], account.savings ? 'Ya' : ''])],
    Transaksi: rows(state, list),
  };
  const names = Object.keys(sheets);
  const files = {
    '[Content_Types].xml': xml('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      names.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '</Types>'),
    '_rels/.rels': xml('<Relationships xmlns="' + packageNamespace + '"><Relationship Id="rId1" Type="' + relNamespace + '/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    'xl/workbook.xml': xml('<workbook xmlns="' + sheetNamespace + '" xmlns:r="' + relNamespace + '"><sheets>' +
      names.map((name, i) => '<sheet name="' + name + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': xml('<Relationships xmlns="' + packageNamespace + '">' +
      names.map((_, i) => '<Relationship Id="rId' + (i + 1) + '" Type="' + relNamespace + '/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') + '</Relationships>'),
  };
  names.forEach((name, index) => { files['xl/worksheets/sheet' + (index + 1) + '.xml'] = worksheet(sheets[name]); });
  return zip(files);
}
