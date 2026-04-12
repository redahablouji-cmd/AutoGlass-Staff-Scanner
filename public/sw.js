// A minimal service worker to pass Android's strict PWA installation check
self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  // Required to pass the PWA install test
});