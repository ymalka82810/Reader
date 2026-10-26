// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'

const read = vi.hoisted(() => vi.fn())
vi.mock('./deviceBooks', () => ({ readDeviceFile: read }))
import { identifyFiles } from './fileIdentity'

const f = (path: string, size = 10) => ({ path, name: path.split('/').pop()!, size, modified: 1 })

describe('identifyFiles', () => {
  it('takes a file the library follows as that book, without opening it', async () => {
    read.mockClear()
    const a = f('/s/a.epub')
    const got = await identifyFiles([a], [{ id: 'b1', title: "פרסי ג'קסון 1 - גנב הברק", author: 'ריק ריירדן' }], new Map([[a.path, 'b1']]))
    expect(got.get(a.path)).toEqual({ title: "פרסי ג'קסון 1 - גנב הברק", author: 'ריק ריירדן' })
    expect(read).not.toHaveBeenCalled()
  })

  it('leaves out a file that cannot be read, and one too big to open', async () => {
    read.mockRejectedValue(new Error('no file access'))
    const broken = f('/s/broken.pdf')
    const huge = f('/s/huge.pdf', 100 * 1024 * 1024)
    const got = await identifyFiles([broken, huge], [], new Map())
    expect(got.size).toBe(0)
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('reports how far it is and stops when cancelled', async () => {
    const seen: number[] = []
    const ctl = new AbortController()
    const files = [f('/s/a.epub'), f('/s/b.epub')]
    await expect(
      identifyFiles(files, [], new Map(), {
        signal: ctl.signal,
        onProgress: (done) => {
          seen.push(done)
          ctl.abort()
        },
      }),
    ).rejects.toThrow()
    expect(seen).toEqual([0])
  })
})
