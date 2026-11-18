import { english } from './translations.mjs';

function stored(key) {
  try { return globalThis.localStorage?.getItem('arus:' + key); } catch { return null; }
}

export let language = stored('language') === 'en' ? 'en' : 'id';
export let theme = ['light', 'dark'].includes(stored('theme')) ? stored('theme') : 'system';
export const locale = () => language === 'en' ? 'en-US' : 'id-ID';
export const t = (text, values) => {
  const message = language === 'en' && Object.hasOwn(english, text) ? english[text] : text;
  return values ? message.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '') : message;
};

export function setPreference(key, value) {
  if (key === 'language' && ['id', 'en'].includes(value)) language = value;
  else if (key === 'theme' && ['system', 'light', 'dark'].includes(value)) theme = value;
  else return;
  try { localStorage.setItem('arus:' + key, value); } catch {}
  if (key === 'theme') window.dispatchEvent(new CustomEvent('arus:theme', { detail: theme }));
}

const categoryDefaults = {
  food: 'Makan', transport: 'Transportasi', bills: 'Tagihan', groceries: 'Belanja bulanan',
  shopping: 'Belanja', fun: 'Hiburan', subs: 'Langganan', misc: 'Lain-lain',
};
const groupDefaults = { needs: 'Kebutuhan', wants: 'Keinginan', other: 'Lainnya' };

export const categoryName = item => categoryDefaults[item.id] === item.name ? t(item.name) : item.name;
export const groupName = item => (groupDefaults[item.id] || (item.id.startsWith('general-') && 'Lainnya')) === item.name ? t(item.name) : item.name;
