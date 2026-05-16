/* ============================================
   TorrentStream PWA - Service Worker
   ============================================ */

const CACHE_NAME = 'torrent-player-v2';
const OFFLINE_URL = '/';

// Assets to cache on install (our own files)
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/SecureStorage.js',
  '/SktorrentProvider.js',
  '/WebshareProvider.js'
];

// ============================================
// INSTALL - Cache static assets
// ============================================
self.addEventListener('install', event => {
  console.log('[SW] Installing service worker...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// ============================================
// ACTIVATE - Clean up old caches
// ============================================
self.addEventListener('activate', event => {
  console.log('[SW] Activating service worker...');
  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames
            .filter(name => name !== CACHE_NAME)
            .map(name => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => self.clients.claim())
  );
});

// ============================================
// FETCH - Stale-while-revalidate for our assets,
//          network-first for everything else
// ============================================
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip WebTorrent tracker connections
  if (url.protocol === 'ws:' || url.protocol === 'wss:') return;

  // For our own origin (static assets), use stale-while-revalidate strategy
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request));
  } else {
    // For external resources (CDN, APIs), use network-first strategy
    event.respondWith(networkFirst(request));
  }
});

/**
 * Stale-while-revalidate strategy: serve from cache immediately,
 * then update cache from network in the background
 * @param {Request} request - The fetch request
 * @returns {Promise<Response>}
 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);

  // Return cached response immediately if available
  if (cachedResponse) {
    // Fetch from network in background to update cache
    fetch(request).then(networkResponse => {
      if (networkResponse && networkResponse.ok) {
        cache.put(request, networkResponse);
      }
    }).catch(() => {
      // Network failed, cached version is fine
    });
    return cachedResponse;
  }

  // No cache, try network
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    // Return offline fallback
    const offlineResponse = await cache.match(OFFLINE_URL);
    if (offlineResponse) return offlineResponse;
    return new Response('Offline', {
      status: 503,
      statusText: 'Service Unavailable'
    });
  }
}

/**
 * Network-first strategy: try network first, fall back to cache
 * @param {Request} request - The fetch request
 * @returns {Promise<Response>}
 */
async function networkFirst(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    return new Response('Offline', {
      status: 503,
      statusText: 'Service Unavailable'
    });
  }
}
