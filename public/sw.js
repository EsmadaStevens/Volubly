// Volubly service worker. It makes the app installable and lets the app shell open when the
// network is flaky. It never touches Firebase, reCAPTCHA or any other site: only files from
// this site, and only with the network first, so a new deploy is always picked up straight away.
// Live chat itself still needs a connection.
const CACHE = 'volubly-shell-v1'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key)
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  if (new URL(req.url).origin !== self.location.origin) return

  event.respondWith(
    (async () => {
      try {
        const res = await fetch(req)
        if (res.ok) {
          const cache = await caches.open(CACHE)
          cache.put(req.mode === 'navigate' ? '/' : req, res.clone())
        }
        return res
      } catch (err) {
        const hit = (await caches.match(req)) || (req.mode === 'navigate' ? await caches.match('/') : undefined)
        if (hit) return hit
        throw err
      }
    })(),
  )
})
