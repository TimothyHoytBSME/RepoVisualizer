const VERSION = 'rv-2';
const SHELL = [
  './', 'index.html', 'style.css', 'manifest.webmanifest', 'icon.svg',
  'src/main.js', 'src/source.js', 'src/zip.js', 'src/cache.js', 'src/langs.js', 'src/analyze.js', 'src/worker.js',
  'src/graph.js', 'src/layout.js', 'src/layout-host.js', 'src/layout-worker.js', 'src/render.js', 'src/controls.js', 'src/panel.js',
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).catch(() => {}));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  const net = req.mode === 'navigate' ? fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' }) : fetch(req, { cache: 'no-cache' });
  e.respondWith(
    net.then(res => {
      if (res.ok) {
        const copy = res.clone();
        e.waitUntil(caches.open(VERSION).then(c => c.put(req.mode === 'navigate' ? 'index.html' : req, copy)));
      }
      return res;
    }).catch(() => caches.match(req.mode === 'navigate' ? 'index.html' : req, { ignoreSearch: true }).then(r => r || Response.error()))
  );
});
