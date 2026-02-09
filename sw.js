const CACHE_NAME = 'linguo-v' + Date.now(); // Уникальное имя КАЖДЫЙ раз
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './catalog.json',
  './index.js',
  './styles.css'
];

// ЯВНАЯ очистка старых кэшей
self.addEventListener('install', (event) => {
  console.log('🆕 Установка НОВОЙ версии SW:', CACHE_NAME);
  
  // 1. Пропускаем ожидание - сразу активируем
  event.waitUntil(self.skipWaiting());
  
  // 2. Удаляем ВСЕ старые кэши
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          console.log('🗑️ Удаляем старый кэш:', cacheName);
          return caches.delete(cacheName);
        })
      );
    })
  );
});

// Немедленная активация
self.addEventListener('activate', (event) => {
  console.log('✅ Активация новой версии SW');
  event.waitUntil(
    Promise.all([
      // Удаляем ВСЕ старые кэши еще раз (на всякий случай)
      caches.keys().then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            return caches.delete(cacheName);
          })
        );
      }),
      // Немедленно берем контроль
      self.clients.claim()
    ])
  );
});

// ВСЕГДА загружаем свежие файлы, НИЧЕГО не кэшируем
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Если это наш сайт и не аудиофайл
  if (url.origin === self.location.origin && 
      !event.request.url.includes('.mp3') &&
      !event.request.url.includes('.opus')) {
    
    // Создаем запрос с timestamp для предотвращения кэша
    const freshUrl = event.request.url + 
      (url.search ? '&' : '?') + 
      '_nocache=' + Date.now();
    
    const freshRequest = new Request(freshUrl, event.request);
    
    event.respondWith(
      fetch(freshRequest)
        .then(response => {
          // НИЧЕГО не кэшируем!
          return response;
        })
        .catch(() => {
          // Только для HTML - минимальный fallback
          if (event.request.destination === 'document') {
            return new Response(
              '<html><body><h1>LinguoPlayer</h1><p>Загрузка...</p></body></html>',
              { headers: { 'Content-Type': 'text/html' } }
            );
          }
          return null;
        })
    );
  }
});