// Imported into the generated service worker (see vite.config.ts).
// Receives files from the Android share sheet (manifest share_target, POST multipart),
// parks them in the Cache API and redirects to the app, which imports them.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'POST' || !url.pathname.endsWith('/share-target')) return
  event.respondWith(
    (async () => {
      const form = await event.request.formData()
      const cache = await caches.open('share-inbox')
      let i = 0
      for (const f of form.getAll('files')) {
        if (!(f instanceof File)) continue
        await cache.put(
          new Request(`${self.registration.scope}inbox/${Date.now()}-${i++}`),
          new Response(f, { headers: { 'x-name': encodeURIComponent(f.name), 'content-type': f.type || 'application/octet-stream' } }),
        )
      }
      return Response.redirect(`${self.registration.scope}?share=1`, 303)
    })(),
  )
})
