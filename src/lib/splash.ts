// The splash screen (#splash in index.html) is plain HTML/CSS so it shows before any script loads.
// Once the app has rendered it fades out, but not before one page has finished flipping, so a fast
// start doesn't flash it for a split second.
const MIN_SHOWN_MS = 1800
const FADE_MS = 400

export function hideSplash(): void {
  const el = document.getElementById('splash')
  if (!el) return
  // automated tests (Playwright) shouldn't wait for the animation
  const wait = navigator.webdriver ? 0 : Math.max(0, MIN_SHOWN_MS - performance.now())
  setTimeout(() => {
    el.classList.add('splash-hide')
    setTimeout(() => el.remove(), FADE_MS)
  }, wait)
}
