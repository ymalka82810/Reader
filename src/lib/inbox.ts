// Files delivered by the OS: the share sheet (via public/share-target.js) or "open with" (launchQueue).

export async function takeSharedFiles(): Promise<File[]> {
  if (!('caches' in window)) return []
  const cache = await caches.open('share-inbox')
  const files: File[] = []
  for (const req of await cache.keys()) {
    const res = await cache.match(req)
    await cache.delete(req)
    if (!res) continue
    const name = decodeURIComponent(res.headers.get('x-name') ?? 'book')
    files.push(new File([await res.blob()], name, { type: res.headers.get('content-type') ?? '' }))
  }
  return files
}

interface LaunchParams {
  files: { getFile(): Promise<File> }[]
}

export function onLaunchFiles(cb: (files: File[]) => void) {
  const q = (window as unknown as { launchQueue?: { setConsumer(f: (p: LaunchParams) => void): void } }).launchQueue
  q?.setConsumer(async (p) => {
    if (p.files.length) cb(await Promise.all(p.files.map((h) => h.getFile())))
  })
}
