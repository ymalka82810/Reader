import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  contentId: async () => 'id1',
  hasBook: async () => false,
  listBooks: async () => [{ id: 'old', title: 'Same', author: 'Me' }],
  saveBook: vi.fn(async () => {}),
  replaceBook: vi.fn(async () => {}),
}))
vi.mock('./db', () => db)
const destroy = vi.fn()
const makeBook = vi.fn(async () => ({ metadata: { title: 'Same', author: 'Me' }, getCover: async () => undefined, destroy }))
vi.mock('foliate-js/view.js', () => ({ makeBook }))
vi.mock('./wordCount', () => ({ wordsOfBook: async () => 1 }))
vi.mock('./drm', () => ({ isDrmEpub: async () => false, isDrmMobi: async () => false }))
vi.mock('./txtToBook', () => ({ extractTxt: async () => ({}) }))
const buildEpub = vi.fn(async () => new Blob(['converted']))
vi.mock('./pdfToEpub', () => ({ buildEpub }))

import { DeferredDuplicate, importFile } from './importBook'

const deferred = async (f: File) => {
  const e = await importFile(f, undefined, async () => 'defer').catch((e: unknown) => e)
  expect(e).toBeInstanceOf(DeferredDuplicate)
  return e as DeferredDuplicate
}

beforeEach(() => vi.clearAllMocks())

describe('importFile: a deferred duplicate', () => {
  it('releases the opened book at once and saves it later without opening it again', async () => {
    const d = await deferred(new File(['x'], 'a.epub'))
    expect(destroy).toHaveBeenCalledTimes(1)
    await d.commit('replace')
    expect(makeBook).toHaveBeenCalledTimes(1)
    expect(db.replaceBook).toHaveBeenCalledWith('old', expect.objectContaining({ title: 'Same' }))
  })

  it('drops a converted copy while it waits and converts it again only if it is kept', async () => {
    const txt = new File(['x'], 'a.txt')
    const d = await deferred(txt)
    expect(destroy).toHaveBeenCalledTimes(1)
    expect(buildEpub).toHaveBeenCalledTimes(1)
    expect(await d.commit('skip')).toBeUndefined()
    expect(buildEpub).toHaveBeenCalledTimes(1)
    const progress = vi.fn()
    await d.commit('add', progress)
    expect(buildEpub).toHaveBeenCalledTimes(2)
    expect(progress).toHaveBeenCalled()
    expect(db.saveBook).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'a.epub' }))
    expect(db.replaceBook).not.toHaveBeenCalled()
  })
})
