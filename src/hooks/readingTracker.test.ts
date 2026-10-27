import { describe, expect, it, vi } from 'vitest'
import { ACTIVE_MS, createReadingTracker, FLUSH_TICKS, MAX_READ_STEP, MIN_ACTIVE_MS, MIN_PAGE_MS, SAVE_DELAY_MS, TICK_MS } from './readingTracker'

function setup() {
  let t = 1_000_000
  let hidden = false
  const timers = new Map<number, { at: number; fn: () => void }>()
  let nextId = 1
  const saveProgress = vi.fn()
  const saveStats = vi.fn()
  const onJump = vi.fn()
  const tracker = createReadingTracker({
    pageFraction: () => 0.01,
    onJump,
    now: () => t,
    isHidden: () => hidden,
    saveProgress,
    saveStats,
    setTimer: (fn, ms) => {
      timers.set(nextId, { at: t + ms, fn })
      return nextId++
    },
    clearTimer: (h) => {
      if (h !== undefined) timers.delete(h)
    },
  })
  const advance = (ms: number) => {
    t += ms
    for (const [id, tm] of [...timers]) {
      if (tm.at <= t) {
        timers.delete(id)
        tm.fn()
      }
    }
  }
  return { tracker, saveProgress, saveStats, onJump, advance, setHidden: (h: boolean) => (hidden = h) }
}

describe('reading tracker', () => {
  it('counts small forward steps as reading and ignores jumps', () => {
    const { tracker, saveStats } = setup()
    tracker.relocate({ fraction: 0.1 })
    tracker.relocate({ fraction: 0.12 })
    tracker.relocate({ fraction: 0.12 + MAX_READ_STEP + 0.01 }) // jump
    tracker.relocate({ fraction: 0.1 }) // backwards
    tracker.flushStats()
    expect(saveStats).toHaveBeenCalledOnce()
    expect(saveStats.mock.calls[0]![1]).toBeCloseTo(0.02)
  })

  it('does not count the first relocate as progress', () => {
    const { tracker, saveStats } = setup()
    tracker.relocate({ fraction: 0.5 })
    tracker.flushStats()
    expect(saveStats).toHaveBeenCalledWith(0, 0)
  })

  it('counts seconds only while active and visible', () => {
    const { tracker, saveStats, advance, setHidden } = setup()
    tracker.tick() // fresh start counts as active
    setHidden(true)
    tracker.tick()
    setHidden(false)
    advance(ACTIVE_MS + 1)
    tracker.tick() // idle too long
    tracker.markActive()
    tracker.tick()
    tracker.flushStats()
    expect(saveStats).toHaveBeenCalledWith((2 * TICK_MS) / 1000, 0)
  })

  it("once the reader's page time is known, a phone left on counts only a few page times", () => {
    const { tracker, saveStats, advance } = setup()
    // a reader who turns a page every 10 s
    for (let i = 0; i <= 5; i++) {
      tracker.relocate({ fraction: 0.1 + i * 0.001 })
      advance(10_000)
    }
    tracker.relocate({ fraction: 0.2 })
    tracker.flushStats()
    // then the phone is put down: ticks for the full old window
    for (let i = 0; i < ACTIVE_MS / TICK_MS; i++) {
      advance(TICK_MS)
      tracker.tick()
    }
    tracker.flushStats()
    // counted until the shortest window (three page times would be 30 s, below the floor)
    expect(saveStats.mock.calls.reduce((a, c) => a + c[0], 0)).toBe(MIN_ACTIVE_MS / 1000 - TICK_MS / 1000)
  })

  it('writes stats every FLUSH_TICKS ticks and resets the counters', () => {
    const { tracker, saveStats } = setup()
    for (let i = 0; i < FLUSH_TICKS; i++) tracker.tick()
    expect(saveStats).toHaveBeenCalledWith((FLUSH_TICKS * TICK_MS) / 1000, 0)
    tracker.flushStats()
    expect(saveStats).toHaveBeenLastCalledWith(0, 0)
  })

  it('debounces progress saves and keeps only the latest position', () => {
    const { tracker, saveProgress, advance } = setup()
    tracker.relocate({ cfi: 'a', fraction: 0.1 })
    advance(SAVE_DELAY_MS - 100)
    tracker.relocate({ cfi: 'b', fraction: 0.2 })
    advance(SAVE_DELAY_MS - 100)
    expect(saveProgress).not.toHaveBeenCalled()
    advance(200)
    expect(saveProgress).toHaveBeenCalledOnce()
    expect(saveProgress).toHaveBeenCalledWith('b', 0.2, [])
  })

  it('flushProgress saves immediately, once', () => {
    const { tracker, saveProgress, advance } = setup()
    tracker.relocate({ cfi: 'a', fraction: 0.3 })
    tracker.flushProgress()
    tracker.flushProgress()
    advance(SAVE_DELAY_MS * 2)
    expect(saveProgress).toHaveBeenCalledOnce()
  })

  it('does not save progress without a cfi', () => {
    const { tracker, saveProgress } = setup()
    tracker.relocate({ fraction: 0.3 })
    tracker.flushProgress()
    expect(saveProgress).not.toHaveBeenCalled()
  })

  describe('what was actually read', () => {
    it('credits pages that had their time, not pages flicked through', () => {
      const { tracker, advance } = setup()
      tracker.relocate({ fraction: 0 })
      for (let i = 1; i <= 10; i++) {
        advance(MIN_PAGE_MS + 100) // reading: each page (1% of the book) got its time
        tracker.relocate({ fraction: i * 0.01 })
      }
      for (let i = 11; i <= 30; i++) {
        advance(200) // flicking
        tracker.relocate({ fraction: i * 0.01 })
      }
      const read = tracker.readRanges()
      expect(read).toHaveLength(1)
      expect(read[0]![0]).toBe(0)
      expect(read[0]![1]).toBeCloseTo(0.1)
    })

    it('saves the read stretches along with the position', () => {
      const { tracker, advance, saveProgress } = setup()
      tracker.relocate({ fraction: 0.2, cfi: 'a' })
      advance(MIN_PAGE_MS * 2)
      tracker.relocate({ fraction: 0.21, cfi: 'b' })
      advance(SAVE_DELAY_MS)
      expect(saveProgress).toHaveBeenLastCalledWith('b', 0.21, [[0.2, 0.21]])
    })

    it('asks about a jump forward over an unread part, and counts it read when told so', () => {
      const { tracker, onJump } = setup()
      tracker.seed([[0, 0.3]])
      tracker.relocate({ fraction: 0.3, cfi: 'a' })
      tracker.relocate({ fraction: 0.3 + MAX_READ_STEP + 0.01, cfi: 'b' }) // little unread before it
      expect(onJump).not.toHaveBeenCalled()
      tracker.relocate({ fraction: 0.9, cfi: 'c' })
      expect(onJump).toHaveBeenCalledWith(0.9)
      tracker.markRead(0, 0.9)
      expect(tracker.readRanges()).toEqual([[0, 0.9]])
    })

    it('never asks about a jump back', () => {
      const { tracker, onJump } = setup()
      tracker.relocate({ fraction: 0.9 })
      tracker.relocate({ fraction: 0.1 })
      expect(onJump).not.toHaveBeenCalled()
    })
  })
})

