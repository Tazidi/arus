import { categoryName, groupName, locale, t } from './preferences.mjs';
import { accountTypes, categories, formatAmount, id, palettes, parseAmount, providers, today, types, validLogo } from './ledger.mjs';
import { esc, logo, option } from './views.mjs';

const $ = selector => document.querySelector(selector);
export const dialog = $('#dialog');
const form = $('#form');
export const formError = $('#form-error');
let submitAction;
export function modal(title, body, submit, label, extra = '') {
  $('#dialog-title').textContent = title;
  $('#dialog-body').innerHTML = body;
  formError.textContent = '';
  $('#dialog-actions').innerHTML = `${extra}<button type="button" class="secondary" data-action="close">${submit ? t('Batal') : t('Tutup')}</button>${submit ? `<button type="submit" class="primary">${label ?? t('Simpan')}</button>` : ''}`;
  submitAction = submit;
  if (!dialog.open) dialog.showModal();
  dialog.querySelector('input:not([type=checkbox]),select')?.focus();
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!submitAction) return;
  const button = event.submitter;
  button.disabled = true;
  try {
    await submitAction(new FormData(form));
    dialog.close();
  } catch (error) { formError.textContent = t(error.message); }
  finally { button.disabled = false; }
});
const input = (name, label, value = '', max = 80, required = true) =>
  `<label>${t(label)}<input name="${name}" value="${esc(value)}" maxlength="${max}" ${required ? 'required' : ''}></label>`;
const amountField = (name, label, value = '', signed = false) =>
  `<label>${t(label)}<input name="${name}" type="text" inputmode="${signed ? 'text' : 'numeric'}" data-rupiah autocomplete="off" value="${esc(formatAmount(value))}" required></label>`;
form.addEventListener('input', event => {
  const input = event.target;
  if (!input.hasAttribute('data-rupiah') || event.isComposing) return;
  const formatted = formatAmount(input.value);
  if (formatted === input.value) return;
  const digitsAfter = input.value.slice(input.selectionStart).replace(/\D/g, '').length;
  let position = formatted.length;
  for (let remaining = digitsAfter; remaining && position > 0;) {
    if (/\d/.test(formatted[--position])) remaining--;
  }
  if (event.inputType === 'deleteContentBackward' && formatted[position - 1] === '.') position--;
  input.value = formatted;
  input.setSelectionRange(position, position);
});
const check = (name, label, checked) => `<label class="check"><input type="checkbox" name="${name}" ${checked ? 'checked' : ''}>${t(label)}</label>`;
export const select = (name, label, options) => `<label>${t(label)}<select name="${name}" required>${options}</select></label>`;
const field = name => form.elements.namedItem(name);
function upsert(items, value) {
  const index = items.findIndex(item => item.id === value.id);
  if (index < 0) items.push(value);
  else items[index] = value;
}
export function transactionForm(state, tx, commit) {
  const typeOptions = Object.entries(types).map(([key, label]) => option(key, t(label), tx?.type || 'expense')).join('');
  const accounts = state.accounts.map(item => option(item.id, item.name, tx?.account)).join('');
  modal(tx ? t('Edit transaksi') : t('Tambah transaksi'), `<div class="form-grid">${select('type', 'Jenis', typeOptions)}
    ${amountField('amount', 'Nominal (Rp)', tx?.amount)}
    <label>${t('Tanggal')}<input type="date" name="date" value="${tx?.date || today()}" required></label>
    ${select('account', 'Rekening', accounts)}<div id="transaction-fields" class="wide"></div>
    <div class="wide">${input('note', 'Catatan (opsional)', tx?.note, 160, false)}</div></div>`, async data => {
    const type = data.get('type');
    const next = { id: tx?.id || id(), date: data.get('date'), amount: parseAmount(data.get('amount')),
      account: data.get('account'), type, category: type === 'expense' ? data.get('category') : '',
      to: type === 'transfer' ? data.get('to') : '', salary: data.has('salary'),
      note: data.get('note').trim(), created: tx?.created || new Date().toISOString() };
    await commit(draft => upsert(draft.transactions, next), 'Transaksi disimpan.');
  }, undefined, tx ? `<button type="button" class="danger" data-action="remove-transaction" data-id="${tx.id}">${t('Hapus')}</button>` : '');
  const fields = $('#transaction-fields');
  const type = field('type');
  const account = field('account');
  let selectedCategory = tx?.category;
  let target = tx?.to;
  let markedSalary = tx?.salary;
  function update() {
    selectedCategory = field('category')?.value || selectedCategory;
    target = field('to')?.value || target;
    markedSalary = field('salary')?.checked ?? markedSalary;
    const active = categories(state).filter(item => item.id === tx?.category || (!item.archived && !item.group.archived))
      .sort((left, right) => categoryName(left).localeCompare(categoryName(right), locale()));
    fields.innerHTML = type.value === 'transfer' ? select('to', 'Rekening tujuan',
      option('', t('Pilih rekening tujuan'), target) + state.accounts.filter(item => item.id !== account.value).map(item => option(item.id, item.name, target)).join('')) :
      (type.value === 'expense' ? select('category', 'Kategori pengeluaran',
        option('', t('Pilih kategori'), selectedCategory) + active.map(item => option(item.id, categoryName(item), selectedCategory)).join('')) : '') +
      check('salary', type.value === 'income' ? t('Pemasukan ini adalah gaji') : t('Pengeluaran ini dari gaji'), markedSalary);
  }
  type.addEventListener('change', update);
  account.addEventListener('change', update);
  update();
}
async function resizeLogo(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
    throw new Error('Pilih logo PNG, JPG, atau WebP berukuran maksimal 5 MB.');
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, 112 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    const preview = canvas.toDataURL('image/webp', 0.86);
    if (!validLogo(preview)) throw new Error('Logo terlalu besar setelah diproses. Pilih gambar lain.');
    return preview;
  } catch (error) {
    if (error instanceof DOMException) throw new Error('Gambar tidak dapat dibaca. Pilih file logo yang lain.');
    throw error;
  } finally { URL.revokeObjectURL(url); }
}
export function accountForm(account, commit) {
  const names = Object.entries(accountTypes).map(([key, label]) => option(key, label, account?.type || 'bank')).join('');
  let customLogo = account?.logo;
  modal(account ? t('Edit rekening') : t('Tambah rekening'), `<div class="form-grid">${select('accountType', 'Jenis rekening', names)}
    <label id="provider-field">${t('Penyedia')}<select name="provider"></select></label>
    <div class="wide" id="custom-provider-field" hidden>${input('customProvider', 'Nama penyedia', account?.customProvider)}</div>
    ${input('name', 'Nama rekening', account?.name)}
    ${amountField('opening', 'Saldo awal (Rp)', account?.opening ?? 0, true)}
    <div class="wide provider-field">
      <span id="provider-logo" aria-label="${t('Pratinjau logo')}"></span>
      <label>${t('Logo kustom')}<input type="file" name="logoFile" accept="image/png,image/jpeg,image/webp"><small>${t('PNG, JPG, atau WebP · Maks. 5 MB')}</small></label>
      <button type="button" id="remove-logo" class="secondary small" hidden>${t('Hapus logo kustom')}</button>
    </div>
    <div class="wide">${check('savings', 'Tandai sebagai tabungan', account?.savings)}</div></div>`, async data => {
    const selected = data.get('provider');
    const customProvider = selected === 'custom' ? data.get('customProvider').trim() : '';
    if (selected === 'custom' && !customProvider) throw new Error('Masukkan nama penyedia.');
    const value = { id: account?.id || id(), name: data.get('name').trim(), type: data.get('accountType'),
      provider: selected && selected !== 'custom' ? selected : '', opening: parseAmount(data.get('opening'), -1e12),
      savings: data.has('savings'), ...(customProvider && { customProvider }), ...(customLogo && { logo: customLogo }) };
    await commit(draft => upsert(draft.accounts, value), 'Rekening disimpan.');
  });
  const type = field('accountType');
  const provider = field('provider');
  const custom = field('customProvider');
  const name = field('name');
  const logoField = field('logoFile');
  const previewBox = $('#provider-logo');
  const removeLogo = $('#remove-logo');
  const preview = () => {
    previewBox.innerHTML = logo({ provider: provider.value, type: type.value, customProvider: custom.value, logo: customLogo });
    removeLogo.hidden = !customLogo;
  };
  const providerChanged = () => {
    const showing = provider.value === 'custom' && !provider.disabled;
    $('#custom-provider-field').hidden = !showing;
    custom.disabled = !showing;
    preview();
  };
  function update(selected) {
    provider.disabled = type.value === 'cash';
    $('#provider-field').hidden = provider.disabled;
    provider.innerHTML = option('', t('Tanpa penyedia'), selected) + Object.entries(providers).filter(([, value]) => value[1] === type.value)
      .map(([key, value]) => option(key, value[0], selected)).join('') + option('custom', t('Ketik penyedia sendiri'), selected);
    if (!name.value && type.value === 'cash') name.value = 'Cash';
    providerChanged();
  }
  update(account?.customProvider ? 'custom' : account?.provider);
  type.addEventListener('change', () => update(''));
  provider.addEventListener('change', () => {
    if (Object.hasOwn(providers, provider.value) && (!name.value || Object.values(providers).some(item => item[0] === name.value))) name.value = providers[provider.value][0];
    providerChanged();
    if (!custom.disabled) custom.focus();
  });
  custom.addEventListener('input', preview);
  removeLogo.addEventListener('click', () => {
    customLogo = undefined;
    logoField.value = '';
    preview();
  });
  logoField.addEventListener('change', async () => {
    const file = logoField.files[0];
    if (!file) return;
    const submit = $('#dialog-actions button[type=submit]');
    submit.disabled = true;
    logoField.disabled = true;
    removeLogo.disabled = true;
    formError.textContent = '';
    try {
      const result = await resizeLogo(file);
      if (!logoField.isConnected) return;
      customLogo = result;
      preview();
    } catch (error) {
      if (logoField.isConnected) formError.textContent = error.message;
    } finally {
      logoField.disabled = false;
      logoField.value = '';
      removeLogo.disabled = false;
      submit.disabled = false;
    }
  });
}
export function groupForm(group, commit) {
  modal(group ? t('Edit kelompok') : t('Tambah kelompok'), input('name', 'Nama kelompok', group ? groupName(group) : '') +
    (group ? select('color', 'Warna', palettes.map((color, index) => option(color, t(['Mint', 'Ungu', 'Kuning', 'Biru', 'Merah muda', 'Hijau'][index]), group.color)).join('')) +
      check('archived', 'Arsipkan kelompok', group.archived) : ''), async data => {
    await commit(draft => {
      const current = draft.groups.find(item => item.id === group?.id);
      const name = data.get('name').trim();
      upsert(draft.groups, { id: group?.id || id(), name: group && name === groupName(group) ? group.name : name,
        color: data.get('color') || palettes[draft.groups.length % palettes.length], categories: current?.categories || [],
        archived: data.has('archived') });
    }, 'Kelompok disimpan.');
  });
}
export function categoryForm(state, group, category, commit, selectedGroup = '') {
  const general = item => !item.archived && item.name === 'Lainnya' && (item.id === 'other' || item.id.startsWith('general-'));
  const groups = state.groups.filter(item => !general(item) && (!item.archived || group?.id === item.id));
  const currentGroup = group ? (general(group) ? '' : group.id) : groups.some(item => item.id === selectedGroup) ? selectedGroup : '';
  modal(category ? t('Edit kategori') : t('Tambah kategori'),
    input('name', 'Nama kategori', category ? categoryName(category) : '') +
    select('group', 'Kelompok (opsional)', option(':general', t('Tanpa kelompok khusus'), currentGroup || ':general') +
      groups.map(item => option(item.id, groupName(item), currentGroup)).join('')) +
    (category ? check('archived', 'Arsipkan kategori', category.archived) : ''), async data => {
    await commit(draft => {
      const selected = data.get('group');
      let destination = draft.groups.find(item => item.id === selected);
      if (selected === ':general') {
        destination = draft.groups.find(item => item.id === group?.id && general(item)) || draft.groups.find(general);
      }
      if (selected === ':general' && !destination) {
        destination = { id: draft.groups.some(item => item.id === 'other') ? 'general-' + id() : 'other',
          name: 'Lainnya', color: palettes[2], categories: [] };
        draft.groups.push(destination);
      }
      if (!destination) throw new Error('Kelompok tidak ditemukan.');
      const previous = draft.groups.find(item => item.id === group?.id);
      const name = data.get('name').trim();
      const value = { id: category?.id || id(), name: category && name === categoryName(category) ? category.name : name,
        archived: data.has('archived') };
      if (previous && previous !== destination) previous.categories = previous.categories.filter(item => item.id !== value.id);
      upsert(destination.categories, value);
    }, 'Kategori disimpan.');
  });
}
