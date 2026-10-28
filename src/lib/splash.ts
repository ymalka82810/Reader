// The splash screen (#splash in index.html) is plain HTML/CSS so it shows before any script loads.
// Once the app has rendered it fades out, but only after two pages have turned all the way over.
// The time is counted from when the splash itself started animating, not from the app's launch: on a
// phone the WebView can take a while before it draws anything, and that time doesn't count as shown.
const MIN_SHOWN_MS = 3300
// with reduced motion there is no flipping, just the icon
const STILL_SHOWN_MS = 800
const FADE_MS = 400

function shownFor(el: HTMLElement): number | undefined {
  const flip = el.getAnimations({ subtree: true }).find((a) => (a as CSSAnimation).animationName === 'sp-flip')
  return flip ? Number(flip.currentTime ?? 0) : undefined
}

export function hideSplash(): void {
  const el = document.getElementById('splash')
  if (!el) return
  const shown = shownFor(el)
  // automated tests (Playwright) shouldn't wait for the animation
  const wait = navigator.webdriver ? 0 : shown === undefined ? STILL_SHOWN_MS : Math.max(0, MIN_SHOWN_MS - shown)
  setTimeout(() => {
    el.classList.add('splash-hide')
    document.documentElement.classList.add('splash-done')
    setTimeout(() => el.remove(), FADE_MS)
  }, wait)
}
