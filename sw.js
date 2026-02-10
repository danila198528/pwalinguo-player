const CACHE_NAME = 'linguo-v13'; // Увеличиваем версию
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './catalog.json',      // Новый каталог
  './index.js',
  './styles.css',
  // Колоды (добавляйте новые сюда)
  './decks/deck-8.json',
  './decks/deck-9.json'
];

// Установка
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Кэшируем файлы для офлайн-работы');
      return Promise.allSettled(
        ASSETS.map(url => {
          return cache.add(url).catch(err => {
            console.log('Не удалось закэшировать:', url, err);
          });
        })
      );
    })
  );
  self.skipWaiting();
});

// Активация
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('Удаляем старый кэш:', key);
            return caches.delete(key);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// Перехват запросов
self.addEventListener('fetch', (event) => {
  // Пропускаем не-GET запросы и внешние ресурсы
  if (event.request.method !== 'GET' || 
      !event.request.url.startsWith(self.location.origin)) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // Если есть в кэше - возвращаем
      if (cachedResponse) {
        return cachedResponse;
      }

      // Если нет в кэше - загружаем из сети
      return fetch(event.request).then((networkResponse) => {
        // Не кэшируем аудио (оно хранится в IndexedDB)
        if (event.request.url.includes('.mp3') || 
            event.request.url.includes('.opus') ||
            event.request.url.includes('audio')) {
          return networkResponse;
        }

        // Клонируем для кэширования
        const responseToCache = networkResponse.clone();
        
        // Кэшируем успешные ответы
        if (networkResponse.status === 200) {
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        
        return networkResponse;
      }).catch(() => {
        // Если сеть недоступна и это HTML - показываем закэшированную страницу
        if (event.request.destination === 'document') {
          return caches.match('./index.html');
        }
        return null;
      });
    })
  );
});