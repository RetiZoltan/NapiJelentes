const CACHE    = 'plexiq-v109';
const PRECACHE = [
  '/', '/index.html',
  '/css/tokens.css', '/css/components.css', '/css/report.css',
  '/js/main.js', '/js/firebase.js', '/js/state.js', '/js/utils.js',
  '/js/db.js', '/js/data-entry.js', '/js/reports.js', '/js/admin.js',
  '/js/employees.js', '/js/tasks.js', '/js/calendar.js',
  '/js/worker-analysis.js', '/js/premium.js', '/js/dashboard.js', '/js/auditlog.js', '/js/help.js', '/js/stock.js', '/js/machines.js', '/js/offlineQueue.js', '/js/wip-bags.js', '/js/analitika.js',
  '/manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(PRECACHE.map(p => new Request(p, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  // HTML: network-first, cache fallback (mindig friss app verziót kapj)
  if (e.request.destination === 'document') {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // JS/CSS/fonts: stale-while-revalidate (cache-ből azonnal, háttérben frissít)
  e.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(e.request).then(cached => {
        const network = fetch(e.request).then(res => {
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        }).catch(() => null);
        return cached || network;
      })
    )
  );
});
