// Registers the service worker (offline use, share target) — except in the Android app, where it only gets in the way.
import { isNativeApp } from './updater'

/** an update that takes over this soon after launch reloads the page; later ones wait for the next launch */
const RELOAD_WINDOW_MS = 15_000

/** Returns true when the page is about to reload, so the caller shouldn't bother rendering. */
export async function setupServiceWorker(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false
  const sw = navigator.serviceWorker

  if (isNativeApp) {
    // The APK already holds the app's files. A service worker left from an earlier version would keep serving
    // that version's cached files after an update, so the new version only showed up on the second launch.
    const regs = await sw.getRegistrations()
    if (!regs.length) return false
    await Promise.all(regs.map((r) => r.unregister()))
    if ('caches' in window) for (const k of await caches.keys()) await caches.delete(k)
    // still running the cached copy: load again, this time straight from the APK
    if (!sw.controller || sessionStorage.getItem('reader:sw-gone')) return false
    sessionStorage.setItem('reader:sw-gone', '1')
    location.reload()
    return true
  }

  // A new version takes over (skipWaiting) while this page still runs the old one. Right after launch, before
  // the user is into anything, switch over at once instead of waiting for the next launch.
  const started = Date.now()
  const hadController = !!sw.controller
  sw.addEventListener('controllerchange', () => {
    if (hadController && Date.now() - started < RELOAD_WINDOW_MS) location.reload()
  })
  window.addEventListener('load', () => {
    sw.register('./sw.js', { scope: './' }).catch((e) => console.warn('service worker registration failed', e))
  })
  return false
}
