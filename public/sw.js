const CACHE_NAME = 'glass-track-v1';

// Install event: cache the main page
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(['/']);
    })
  );
});

// Activate event: take control immediately
self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

// Fetch event: Serve from network, fallback to cache if offline
self.addEventListener('fetch', (e) => {
  e.respondWith(
    fetch(e.request).catch(() => {
      return caches.match('/');
    })
  );
});