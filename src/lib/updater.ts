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

// The newest release in `repo` whose tag starts with `tag` + a digit and ends with its versionCode,
// if that is newer than the installed APK; otherwise null.
export async function findUpdate(repo: string, tag: string): Promise<{ version: string; url: string } | null> {
  const { versionCode } = await appInfo()
  const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=30`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const ours = new RegExp(`^${tag}\\d`)
  const releases = (await res.json()) as {
    draft: boolean
    prerelease: boolean
    tag_name: string
    assets: { name: string; browser_download_url: string }[]
  }[]
  const release = releases.find((r) => !r.draft && !r.prerelease && ours.test(r.tag_name))
  if (!release) return null
  const latest = Number(/(\d+)$/.exec(release.tag_name)?.[1] ?? 0)
  const apk = release.assets.find((a) => a.name.endsWith('.apk'))
  if (latest <= versionCode || !apk) return null
  return { version: release.tag_name.slice(tag.length), url: apk.browser_download_url }
}

// Downloads the APK via the system DownloadManager and opens the install dialog. onProgress gets 0–100 (-1 if unknown).
// Rejects with Error("busy" | "bad url" | "download" | "not an update" | "permission" | "no installer").
export async function installUpdate(url: string, onProgress?: (percent: number) => void): Promise<void> {
  const listener = onProgress && cap!.addListener('AppUpdater', 'progress', (e) => onProgress(e.percent))
  try {
    await cap!.nativePromise('AppUpdater', 'downloadAndInstall', { url })
  } finally {
    listener?.remove()
  }
}
