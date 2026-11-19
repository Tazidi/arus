const cacheName = 'arus-shell-v11';
const assets = ['./', './index.html', './styles.css', './app.mjs', './ledger.mjs', './category-catalog.mjs', './storage.mjs', './exports.mjs',
  './views.mjs', './theme.js', './preferences.mjs', './translations.mjs', './forms.mjs', './drive.mjs', './config.mjs', './manifest.webmanifest', './icon.png', './icon-192.png',
  ...['bca', 'mandiri', 'bri', 'bni', 'bsi', 'jago', 'gopay', 'ovo', 'dana', 'shopeepay', 'linkaja'].map(name => './assets/' + name + '.svg')];
self.addEventListener('install', event => event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(assets)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('arus-shell-') && key !== cacheName).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  if (!assets.some(asset => new URL(asset, self.registration.scope).pathname === url.pathname)) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(cacheName).then(cache => cache.put(url.pathname, copy)));
    }
    return response;
  }).catch(async () => {
    const cached = await caches.match(url.pathname);
    return cached || (event.request.mode === 'navigate' ? caches.match('./index.html') : Response.error());
  }));
});
