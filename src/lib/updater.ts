// Self-update for the sideloaded Android APK, published as a GitHub release asset.
// Talks to the native AppUpdater plugin (resources/android-updater/AppUpdaterPlugin.java)
// through the injected Capacitor bridge, so @capacitor/core isn't bundled.

interface CapacitorBridge {
  isNativePlatform?: () => boolean
  nativePromise: <T>(plugin: string, method: string, options?: object) => Promise<T>
  addListener: (plugin: string, event: string, cb: (e: { percent: number }) => void) => { remove: () => void }
}

const cap = (window as unknown as { Capacitor?: CapacitorBridge }).Capacitor

export const isNativeApp = !!cap?.isNativePlatform?.()

const appInfo = () => cap!.nativePromise<{ versionCode: number; versionName: string }>('AppUpdater', 'appInfo')

interface Release {
  draft: boolean
  prerelease: boolean
  tag_name: string
  body: string | null
  assets: { name: string; browser_download_url: string }[]
}

const CACHE_KEY = 'updater-releases'

// Anonymous GitHub API calls are limited to 60/hour per IP. Revalidating with the stored ETag
// answers 304, which doesn't count against the limit, and the cached list is used if we're limited anyway.
async function fetchReleases(repo: string): Promise<Release[]> {
  let cached: { repo: string; etag: string; releases: Release[] } | undefined
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null')
    if (c?.repo === repo) cached = c
  } catch { /* no usable cache */ }
  const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=30`, {
    headers: cached ? { 'If-None-Match': cached.etag } : {},
    cache: 'no-store',
  })
  if (res.status === 304 && cached) return cached.releases
  if (!res.ok) {
    if (cached && (res.status === 403 || res.status === 429)) return cached.releases
    throw new Error(`HTTP ${res.status}`)
  }
  const releases = (await res.json()) as Release[]
  const etag = res.headers.get('ETag')
  if (etag) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ repo, etag, releases })) } catch { /* storage full or blocked */ }
  }
  return releases
}

// The newest release in `repo` whose tag starts with `tag` + a digit, if its versionCode (written in the
// release notes by the build; the tag's trailing number is the fallback) is newer than the installed APK.
export async function findUpdate(repo: string, tag: string): Promise<{ version: string; url: string; sha256?: string } | null> {
  const { versionCode } = await appInfo()
  const ours = new RegExp(`^${tag}\\d`)
  const release = (await fetchReleases(repo)).find((r) => !r.draft && !r.prerelease && ours.test(r.tag_name))
  if (!release) return null
  const body = release.body ?? ''
  const latest = Number(/^versionCode:\s*(\d+)/m.exec(body)?.[1] ?? /(\d+)$/.exec(release.tag_name)?.[1] ?? 0)
  const sha256 = /^sha256:\s*([0-9a-f]{64})\s*$/im.exec(body)?.[1].toLowerCase()
  const apk = release.assets.find((a) => a.name.endsWith('.apk'))
  if (latest <= versionCode || !apk) return null
  return { version: release.tag_name.slice(tag.length), url: apk.browser_download_url, sha256 }
}

// Downloads the APK via the system DownloadManager, checks its SHA-256 (when given) and opens the install dialog.
// onProgress gets 0–100 (-1 if unknown).
// Rejects with Error("busy" | "bad url" | "download" | "checksum" | "not an update" | "permission" | "no installer").
export async function installUpdate(url: string, sha256?: string, onProgress?: (percent: number) => void): Promise<void> {
  const listener = onProgress && cap!.addListener('AppUpdater', 'progress', (e) => onProgress(e.percent))
  try {
    await cap!.nativePromise('AppUpdater', 'downloadAndInstall', { url, sha256 })
  } finally {
    listener?.remove()
  }
}
