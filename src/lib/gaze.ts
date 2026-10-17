export interface Landmark {
  x: number
  y: number
}

export type GazeMove = 'down' | 'up'

/** face-mesh landmark indices (with iris refinement): upper lid, lower lid, iris centre, eye corners */
const EYES = [
  { upper: 159, lower: 145, iris: 468, a: 33, b: 133 },
  { upper: 386, lower: 374, iris: 473, a: 362, b: 263 },
]
/** eye opening relative to eye width below which the eye counts as closed (blink) */
const MIN_OPENNESS = 0.15

/**
 * Where the iris sits between the eyelids, averaged over both eyes: about 0.5 looking straight ahead,
 * larger looking down, smaller looking up. null when there is no usable eye (no face, or blinking).
 */
export function verticalGaze(lm: readonly Landmark[]): number | null {
  const ratios: number[] = []
  for (const e of EYES) {
    const upper = lm[e.upper]
    const lower = lm[e.lower]
    const iris = lm[e.iris]
    const a = lm[e.a]
    const b = lm[e.b]
    if (!upper || !lower || !iris || !a || !b) return null
    const open = lower.y - upper.y
    const width = Math.hypot(a.x - b.x, a.y - b.y)
    if (width <= 0 || open / width < MIN_OPENNESS) continue
    ratios.push((iris.y - upper.y) / open)
  }
  return ratios.length ? ratios.reduce((x, y) => x + y, 0) / ratios.length : null
}

export interface GazeOptions {
  /** how far from the calibrated straight-ahead ratio counts as looking down / up */
  threshold: number
  /** how long the gaze must stay there */
  dwellMs: number
  /** quiet time after a move, so one look is one page */
  cooldownMs: number
  /** how long the reader looks at the middle of the screen at the start, to learn the straight-ahead ratio */
  calibrateMs: number
}

const DEFAULTS: GazeOptions = { threshold: 0.1, dwellMs: 700, cooldownMs: 1500, calibrateMs: 2000 }

const SMOOTHING = 0.3
/** without a usable sample this long, the look is forgotten */
const LOST_MS = 1000

const median = (xs: number[]) => {
  const s = [...xs].sort((p, q) => p - q)
  return s[Math.floor(s.length / 2)] ?? 0
}

/** Turns a stream of vertical-gaze samples into "down" / "up" moves after a dwell. */
export function createGazeTracker(opts: Partial<GazeOptions> = {}) {
  const o = { ...DEFAULTS, ...opts }
  let samples: number[] = []
  let calibrateFrom: number | null = null
  let baseline: number | null = null
  let smooth = 0
  let side: GazeMove | null = null
  let since = 0
  let lastGood = 0
  let blockedUntil = 0

  return {
    get calibrated() {
      return baseline !== null
    },
    /** forget the straight-ahead ratio; the next samples calibrate again */
    recalibrate() {
      samples = []
      calibrateFrom = null
      baseline = null
      side = null
    },
    feed(ratio: number | null, now: number): GazeMove | null {
      if (ratio === null) {
        if (now - lastGood > LOST_MS) side = null
        return null
      }
      lastGood = now
      if (baseline === null) {
        calibrateFrom ??= now
        samples.push(ratio)
        if (now - calibrateFrom >= o.calibrateMs && samples.length >= 5) {
          baseline = median(samples)
          smooth = baseline
          blockedUntil = now + o.cooldownMs
        }
        return null
      }
      smooth += SMOOTHING * (ratio - smooth)
      const delta = smooth - baseline
      const looking: GazeMove | null = delta > o.threshold ? 'down' : delta < -o.threshold ? 'up' : null
      if (looking !== side) {
        side = looking
        since = now
        return null
      }
      if (!side || now - since < o.dwellMs || now < blockedUntil) return null
      blockedUntil = now + o.cooldownMs
      return side
    },
  }
}
