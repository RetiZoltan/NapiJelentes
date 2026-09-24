const CACHE    = 'plexiq-v177';
const PRECACHE = [
  '/', '/index.html',
  '/css/tokens.css', '/css/components.css', '/css/report.css',
  '/js/main.js', '/js/firebase.js', '/js/state.js', '/js/utils.js',
  '/js/db.js', '/js/data-entry.js', '/js/reports.js', '/js/admin.js',
  '/js/employees.js', '/js/tasks.js', '/js/calendar.js',
  '/js/premium.js', '/js/dashboard.js', '/js/auditlog.js', '/js/help.js', '/js/stock.js', '/js/machines.js', '/js/offlineQueue.js', '/js/wip-bags.js', '/js/analitika.js',
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

  // Minden saját fájl (HTML, JS, CSS, stb.): network-first, cache csak offline
  // fallbackként. A JS-t korábban stale-while-revalidate szolgálta ki — ez
  // deploy után a HTML-lel ellentétben egy darabig a RÉGI, gépen cache-elt
  // kódot futtatta az új felület mellett, ami csendes, hibás mentéseket
  // okozhatott (pl. eltérő adatszerkezetet váró logika fut az új DOM-on).
  // Így mindenki azonnal friss kódot kap minden deploy után, amint van net.
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
