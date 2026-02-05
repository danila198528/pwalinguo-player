const CACHE_NAME = 'linguo-simple';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './catalog.json',
  './index.js',
  './styles.css'
];

// Установка
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Активация
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Перехват
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then(cached => cached || fetch(event.request))
  );
});