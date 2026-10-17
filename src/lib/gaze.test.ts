import { describe, expect, it } from 'vitest'
import { createGazeTracker, verticalGaze, type Landmark } from './gaze'

/** landmarks for two open eyes whose iris sits at `ratio` between the lids (0 = top, 1 = bottom) */
function face(ratio: number, open = 0.02): Landmark[] {
  const lm: Landmark[] = Array.from({ length: 478 }, () => ({ x: 0, y: 0 }))
  const eye = (cx: number, i: { upper: number; lower: number; iris: number; a: number; b: number }) => {
    lm[i.a] = { x: cx - 0.03, y: 0.5 }
    lm[i.b] = { x: cx + 0.03, y: 0.5 }
    lm[i.upper] = { x: cx, y: 0.5 }
    lm[i.lower] = { x: cx, y: 0.5 + open }
    lm[i.iris] = { x: cx, y: 0.5 + open * ratio }
  }
  eye(0.35, { upper: 159, lower: 145, iris: 468, a: 33, b: 133 })
  eye(0.65, { upper: 386, lower: 374, iris: 473, a: 362, b: 263 })
  return lm
}

describe('verticalGaze', () => {
  it('reads the iris position between the lids', () => {
    expect(verticalGaze(face(0.5))).toBeCloseTo(0.5)
    expect(verticalGaze(face(0.8))).toBeCloseTo(0.8)
  })
  it('ignores closed eyes', () => {
    expect(verticalGaze(face(0.5, 0.002))).toBeNull()
  })
  it('is null without landmarks', () => {
    expect(verticalGaze([])).toBeNull()
  })
})

/** feeds `ratio` every 33 ms from `from` to `to`, returns the moves it produced */
function run(t: ReturnType<typeof createGazeTracker>, ratio: number, from: number, to: number) {
  const moves: string[] = []
  for (let now = from; now < to; now += 33) {
    const m = t.feed(ratio, now)
    if (m) moves.push(m)
  }
  return moves
}

describe('createGazeTracker', () => {
  const calibrated = () => {
    const t = createGazeTracker()
    run(t, 0.5, 0, 2200)
    return t
  }

  it('does nothing while calibrating', () => {
    const t = createGazeTracker()
    expect(run(t, 0.9, 0, 1900)).toEqual([])
    expect(t.calibrated).toBe(false)
  })
  it('turns down after a sustained look down, once', () => {
    const t = calibrated()
    expect(t.calibrated).toBe(true)
    expect(run(t, 0.75, 4000, 5000)).toEqual(['down'])
  })
  it('turns up after a sustained look up', () => {
    expect(run(calibrated(), 0.25, 4000, 5000)).toEqual(['up'])
  })
  it('ignores a short glance and straight-ahead reading', () => {
    const t = calibrated()
    expect(run(t, 0.75, 4000, 4300)).toEqual([])
    expect(run(t, 0.5, 4300, 6000)).toEqual([])
  })
  it('repeats only after the cooldown', () => {
    expect(run(calibrated(), 0.75, 4000, 7000)).toHaveLength(2)
  })
  it('calibrates again on request', () => {
    const t = calibrated()
    t.recalibrate()
    expect(t.calibrated).toBe(false)
    expect(run(t, 0.75, 4000, 6200)).toEqual([])
    expect(t.calibrated).toBe(true)
  })
})
