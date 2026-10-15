export interface StorageStatus {
  /** true when the browser promised not to evict the library under storage pressure */
  persisted: boolean
  usage?: number
  quota?: number
}

/** ask the browser not to evict the library (IndexedDB); resolves to whether it was granted */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (await navigator.storage?.persisted?.()) return true
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}

export async function getStorageStatus(): Promise<StorageStatus> {
  const persisted = await requestPersistence()
  try {
    const { usage, quota } = (await navigator.storage?.estimate?.()) ?? {}
    return { persisted, usage, quota }
  } catch {
    return { persisted }
  }
}

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 1 : 0)} MB`
  return `${(n / 1024 ** 3).toFixed(1)} GB`
}
