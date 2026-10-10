/* ==========================================================================
   sw.js — Service Worker (offline-first)
   Strategie:
     • Shell-ul aplicatiei (HTML/CSS/JS/date) → cache-first cu actualizare in fundal
     • Navigarile → network-first, cu fallback pe index.html cand e offline
   Datele de vanzare nu trec prin service worker: ele raman in localStorage/IndexedDB.
   ========================================================================== */

var CACHE = 'pos-shell-v1';

var ASSETS = [
  './',
  './index.html',
  './pos.html',
  './client-display.html',
  './products.html',
  './operators.html',
  './reports.html',
  './settings.html',
  './css/style.css',
  './css/components.css',
  './css/responsive.css',
  './js/db.js',
  './js/utils.js',
  './js/app.js',
  './js/auth.js',
  './js/sync.js',
  './js/pos-handler.js',
  './js/products.js',
  './js/operators.js',
  './js/reports.js',
  './js/settings.js',
  './js/client-display.js',
  './data/sample-products.json',
  './data/sample-operators.json',
  './manifest.webmanifest'
];

/* --- Instalare: pre-incarca shell-ul --- */
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE)
      .then(function (cache) {
        // addAll esueaza daca o singura resursa lipseste; incarcam individual
        return Promise.all(ASSETS.map(function (url) {
          return cache.add(url).catch(function (err) {
            console.warn('[SW] Nu am putut salva in cache:', url, err && err.message);
          });
        }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

/* --- Activare: curata cache-urile vechi --- */
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* --- Interceptare cereri --- */
self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // doar resursele proprii

  // Navigare (pagina HTML): network-first, fallback offline
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(function (res) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
          return res;
        })
        .catch(function () {
          return caches.match(req).then(function (r) {
            return r || caches.match('./index.html');
          });
        })
    );
    return;
  }

  // Resurse statice: cache-first + actualizare in fundal (stale-while-revalidate)
  event.respondWith(
    caches.match(req).then(function (cached) {
      var network = fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return cached; });
      return cached || network;
    })
  );
});
