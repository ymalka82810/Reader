import { beforeEach, describe, expect, it } from 'vitest'
import { begin, bookKey, crashedBefore, end, forgetCrashed, guarded, pathKey, recoverCrash, takeCrashNotice } from './crashGuard'

describe('crashGuard', () => {
  beforeEach(() => localStorage.clear())

  it('a file still being worked on when the app starts again is set aside, and named once', () => {
    begin(pathKey('/Download/big.cbr'), 'big.cbr', 'import')
    // the app closed here; on the next start:
    expect(recoverCrash()).toBe(1)
    expect(crashedBefore(pathKey('/Download/big.cbr'))).toBe(true)
    expect(takeCrashNotice()).toEqual(['big.cbr'])
    expect(takeCrashNotice()).toBeUndefined()
    expect(recoverCrash()).toBe(0)
  })

  it('work that ended, however it ended, sets nothing aside', async () => {
    await guarded(bookKey('a'), 'A', 'identify', async () => 1)
    await guarded(bookKey('b'), 'B', 'identify', async () => {
      throw new Error('bad file')
    }).catch(() => {})
    begin(pathKey('/x.epub'), 'x.epub', 'import')
    end(pathKey('/x.epub'))
    expect(recoverCrash()).toBe(0)
    expect(crashedBefore(bookKey('a')) || crashedBefore(bookKey('b')) || crashedBefore(pathKey('/x.epub'))).toBe(false)
  })

  it('a file set aside that goes through later is no longer set aside', () => {
    begin(pathKey('/y.pdf'), 'y.pdf', 'import')
    recoverCrash()
    forgetCrashed(pathKey('/y.pdf'))
    expect(crashedBefore(pathKey('/y.pdf'))).toBe(false)
  })
})
