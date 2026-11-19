const presets = [
  ['food', 'Makan & Minum', '🍽️', 'Makan siang, kopi, jajan, pesan makanan', ['makan', 'makan siang', 'makan malam', 'sarapan', 'kopi', 'kopi susu', 'jajan', 'pesan makanan', 'cemilan', 'camilan'], 'Makan'],
  ['groceries', 'Belanja Dapur', '🛒', 'Bahan makanan dan kebutuhan dapur', ['belanja dapur', 'bahan makanan', 'kebutuhan dapur', 'sayur', 'belanja bulanan'], 'Belanja bulanan'],
  ['transport', 'Transportasi', '🚗', 'Bensin, parkir, tol, ojek, angkutan umum', ['bensin', 'parkir', 'tol', 'ojek', 'angkutan umum']],
  ['housing', 'Tempat Tinggal', '🏠', 'Sewa, kos, perawatan rumah', ['sewa rumah', 'kos', 'kost', 'perawatan rumah']],
  ['bills', 'Tagihan Rumah & Komunikasi', '💡', 'Listrik, air, internet, pulsa', ['tagihan', 'listrik', 'air', 'internet', 'wifi', 'pulsa'], 'Tagihan'],
  ['health', 'Kesehatan', '🩺', 'Obat, vitamin, dokter, pemeriksaan', ['obat', 'vitamin', 'dokter', 'pemeriksaan']],
  ['personal-care', 'Perawatan Diri', '🧴', 'Potong rambut, skincare, toiletries', ['potong rambut', 'skincare', 'toiletries']],
  ['shopping', 'Belanja Barang', '🛍️', 'Pakaian, elektronik, perlengkapan rumah', ['belanja', 'pakaian', 'elektronik', 'perlengkapan rumah'], 'Belanja'],
  ['education-work', 'Pendidikan & Kerja', '📚', 'Kursus, buku, alat tulis', ['kursus', 'buku', 'alat tulis']],
  ['fun', 'Hiburan & Hobi', '🎮', 'Bioskop, game, olahraga, perlengkapan hobi', ['hiburan', 'bioskop', 'game', 'olahraga', 'perlengkapan hobi'], 'Hiburan'],
  ['subs', 'Langganan Digital', '📱', 'Spotify, Netflix, penyimpanan cloud', ['langganan', 'spotify', 'netflix', 'penyimpanan cloud'], 'Langganan'],
  ['family-gifts', 'Keluarga, Hadiah & Donasi', '🎁', 'Bantuan keluarga, kado, donasi', ['bantuan keluarga', 'kado', 'hadiah', 'donasi']],
  ['installments', 'Cicilan & Pinjaman', '💳', 'Pembayaran SPayLater, cicilan kendaraan', ['spaylater', 'cicilan', 'cicilan kendaraan', 'pinjaman']],
  ['fees', 'Biaya Admin', '🧾', 'Biaya bank, layanan, dan transfer', ['admin', 'biaya bank', 'biaya layanan', 'biaya transfer']],
  ['misc', 'Lain-lain', '📌', 'Pengeluaran lain yang jarang muncul', []],
];

export const defaultCategoryIcon = '🏷️';
export const categoryIconLabels = presets.map(([, name]) => name);
export const categoryIcons = [defaultCategoryIcon, ...presets.map(([, , icon]) => icon)];
const byId = new Map(presets.map(preset => [preset[0], preset]));
const normalize = name => name.trim().toLocaleLowerCase('id').replace(/\s+/g, ' ');
const fromPreset = ([id, name, icon, examples, aliases]) => ({ id, name, icon, examples, aliases: [...aliases] });
export const defaultCategories = () => presets.map(fromPreset);
export const isGeneralGroup = group => !!group && group.name === 'Lainnya' &&
  (group.id === 'other' || group.id.startsWith('general-'));
export const isDefaultGroup = group => isGeneralGroup(group) ||
  (group.id === 'needs' && group.name === 'Kebutuhan') || (group.id === 'wants' && group.name === 'Keinginan');

export function generalGroup(groups) {
  const existing = groups.find(group => isGeneralGroup(group) && !group.archived);
  if (existing) return existing;
  let id = 'other';
  for (let index = 1; groups.some(group => group.id === id); index++) id = 'general-' + index;
  const group = { id, name: 'Lainnya', color: '#ffc578', categories: [] };
  groups.push(group);
  return group;
}

export function catalogLabel(item) {
  const preset = byId.get(item.id);
  return preset && (item.name === preset[1] || item.name === preset[5]) ? item.name : '';
}

export function catalogExamples(item) {
  return item.examples ?? (catalogLabel(item) ? byId.get(item.id)[3] : '');
}

export function catalogIcon(item) {
  return item.icon || (catalogLabel(item) ? byId.get(item.id)[2] : defaultCategoryIcon);
}

export function installCategoryCatalog(state) {
  const ids = new Set();
  const names = new Set();
  const owners = new Map();
  for (const group of state.groups) {
    for (const item of group.categories) {
      const name = normalize(item.name);
      const matches = owners.get(name) || [];
      matches.push(item.id);
      owners.set(name, matches);
    }
  }
  let changed = false;
  const groups = state.groups.map(group => {
    let groupChanged = false;
    const categories = group.categories.map(item => {
      ids.add(item.id);
      names.add(normalize(item.name));
      if (!catalogLabel(item)) return item;
      const preset = fromPreset(byId.get(item.id));
      const taken = owners.get(normalize(preset.name))?.some(id => id !== item.id);
      const name = taken ? item.name : preset.name;
      names.add(normalize(name));
      if (item.name === name && item.icon !== undefined && item.examples !== undefined && item.aliases !== undefined) return item;
      changed = groupChanged = true;
      return { ...item, name, icon: item.icon ?? preset.icon, examples: item.examples ?? preset.examples, aliases: item.aliases ?? preset.aliases };
    });
    return groupChanged ? { ...group, categories } : group;
  });
  const missing = defaultCategories().filter(item => !ids.has(item.id) && !names.has(normalize(item.name)));
  if (missing.length) {
    const group = generalGroup(groups);
    groups[groups.indexOf(group)] = { ...group, categories: [...group.categories, ...missing] };
    changed = true;
  }
  return changed ? { ...state, groups } : state;
}
