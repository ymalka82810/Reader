// Files delivered by the OS: the share sheet (via public/share-target.js), "open with" (launchQueue) and, in the
// Android app, "open with" / share through the native OpenWith plugin (resources/android-open-with/OpenWithPlugin.java).
// Talks to it through the injected Capacitor bridge, so @capacitor/core isn't bundled.

interface CapacitorBridge {
  isNativePlatform?: () => boolean
  isPluginAvailable?: (name: string) => boolean
  nativePromise: <T>(plugin: string, method: string, options?: object) => Promise<T>
  convertFileSrc?: (path: string) => string
}

const cap = () => (globalThis as unknown as { Capacitor?: CapacitorBridge }).Capacitor

const TYPES: Record<string, string> = { epub: 'application/epub+zip', pdf: 'application/pdf' }

/** the files the Android app was opened with since the last call (a copy of each sits in the app's cache) */
async function takeNativeFiles(): Promise<File[]> {
  const c = cap()
  if (!c?.isNativePlatform?.() || !(c.isPluginAvailable?.('OpenWith') ?? true)) return []
  try {
    const { files } = await c.nativePromise<{ files: { path: string; name: string }[] }>('OpenWith', 'takePending')
    const read = await Promise.allSettled(
      files.map(async (f) => {
        // encoded per segment, so a '#', '?' or '%' in a file name stays part of the path
        const src = c.convertFileSrc?.(f.path.split('/').map(encodeURIComponent).join('/'))
        if (!src) throw new Error('no file access')
        const res = await fetch(src)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
        return new File([await res.blob()], f.name, { type: TYPES[ext] ?? '' })
      }),
    )
    return read.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
  } catch {
    return []
  }
}

export async function takeSharedFiles(): Promise<File[]> {
  const native = await takeNativeFiles()
  if (!('caches' in window)) return native
  const cache = await caches.open('share-inbox')
  const files: File[] = []
  for (const req of await cache.keys()) {
    const res = await cache.match(req)
    await cache.delete(req)
    if (!res) continue
    const name = decodeURIComponent(res.headers.get('x-name') ?? 'book')
    files.push(new File([await res.blob()], name, { type: res.headers.get('content-type') ?? '' }))
  }
  return [...native, ...files]
}

interface LaunchParams {
  files: { getFile(): Promise<File> }[]
}

export function onLaunchFiles(cb: (files: File[]) => void) {
  const q = (window as unknown as { launchQueue?: { setConsumer(f: (p: LaunchParams) => void): void } }).launchQueue
  q?.setConsumer(async (p) => {
    if (p.files.length) cb(await Promise.all(p.files.map((h) => h.getFile())))
  })
  // Android app: a book opened while the app is already running brings it back to the front (no reload), so look
  // for new files whenever the app becomes visible again. takePending forgets what it returned, so two triggers
  // at once can't import a file twice.
  const pull = () => void takeNativeFiles().then((f) => f.length && cb(f))
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) pull()
  })
  window.addEventListener('focus', pull)
}
