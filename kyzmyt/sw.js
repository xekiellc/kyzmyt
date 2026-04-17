const CACHE_NAME = 'kyzmyt-v1';
const STATIC_CACHE = 'kyzmyt-static-v1';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/pages/app.html',
  '/pages/login.html',
  '/pages/signup.html',
  '/pages/verify.html',
  '/pages/messages.html',
  '/pages/matches.html',
  '/pages/community.html',
  '/pages/profile.html',
  '/css/design-system.css',
  '/js/supabase.js',
  '/manifest.json'
];

// Install: cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('Service worker cache failed for some assets:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME && name !== STATIC_CACHE)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Fetch: cache-first for static, network-first for API
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip Supabase API calls and Netlify functions — always network
  if (
    url.hostname.includes('supabase.co') ||
    url.pathname.startsWith('/.netlify/functions/') ||
    url.pathname.startsWith('/api/')
  ) {
    return; // Let browser handle normally
  }

  // For navigation requests and static assets: stale-while-revalidate
  if (request.mode === 'navigate' || STATIC_ASSETS.some(a => url.pathname === a)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then((cache) => {
        return cache.match(request).then((cached) => {
          const fetched = fetch(request).then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          }).catch(() => cached);
          return cached || fetched;
        });
      })
    );
    return;
  }

  // Default: network only
});

// Push notifications
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data;
  try { data = event.data.json(); }
  catch { data = { title: 'Kyzmyt', body: event.data.text() }; }

  event.waitUntil(
    self.registration.showNotification(data.title || 'Kyzmyt', {
      body: data.body || 'You have a new notification',
      icon: '/assets/icon-192.png',
      badge: '/assets/badge-72.png',
      data: { url: data.url || '/pages/app.html' },
      actions: data.actions || [],
      tag: data.tag || 'kyzmyt-notification'
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/pages/app.html';
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
