import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PACK_VERSION, shardOf, type PackHeader, type Shard } from './dictPackFormat'
import { downloadPack, fetchPackList, installedPacks, lookUpOffline, removePack } from './offlineDict'

/** a pack like the build script writes: a header line, then one shard per line */
function packFile(lang: string, words: Record<string, [string, ...string[]][]>, forms: Record<string, string>, over: Partial<PackHeader> = {}) {
  const shards = 3
  const parts: Shard[] = Array.from({ length: shards }, () => ({ e: {}, f: {} }))
  for (const [w, e] of Object.entries(words)) parts[shardOf(w, shards)]!.e[w] = e
  for (const [f, w] of Object.entries(forms)) parts[shardOf(f, shards)]!.f[f] = w
  const header: PackHeader = { v: PACK_VERSION, lang, shards, words: Object.keys(words).length, built: '2026-10-23', ...over }
  return [header, ...parts].map((l) => JSON.stringify(l) + '\n').join('')
}

const serve = (body: BodyInit, init: ResponseInit = {}) => vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, init)))
const gz = (text: string) => new Uint8Array(gzipSync(text))

afterEach(async () => {
  vi.unstubAllGlobals()
  await removePack('en')
  await removePack('he')
})

const dog: [string, ...string[]][] = [['noun', 'a domesticated canine', 'a man'], ['verb', 'to follow closely']]

describe('offline dictionary', () => {
  it('has nothing before a pack is downloaded', async () => {
    expect(await lookUpOffline('en', 'dog')).toBeNull()
    expect(await installedPacks()).toEqual({})
  })

  it('downloads a pack and looks words up in it', async () => {
    serve(gz(packFile('en', { dog, Paris: [['name', 'the capital of France']] }, { dogs: 'dog' })))
    const progress: number[] = []
    await downloadPack('en', 1000, (p) => progress.push(p))
    expect(progress.at(-1)).toBe(1)
    expect((await installedPacks()).en).toMatchObject({ words: 2, built: '2026-10-23', shards: 3 })

    expect(await lookUpOffline('en', 'dog')).toBe('noun\n1. a domesticated canine\n2. a man\n\nverb\n1. to follow closely')
    // a form shows the entry of its base word, and a capitalised word at the start of a sentence still finds the lower-case entry
    expect(await lookUpOffline('en', 'dogs')).toContain('צורה של ״dog״:')
    expect(await lookUpOffline('en', 'Dog')).toContain('a domesticated canine')
    expect(await lookUpOffline('en', 'Paris')).toContain('the capital of France')
    expect(await lookUpOffline('en', 'zzz')).toBeNull()
    // words that are also properties of every object must not be taken for entries
    expect(await lookUpOffline('en', 'constructor')).toBeNull()
  })

  it('ignores niqqud when looking up Hebrew', async () => {
    serve(gz(packFile('he', { כלב: [['noun', 'dog']] }, {})))
    await downloadPack('he', 0, () => {})
    expect(await lookUpOffline('he', 'כֶּלֶב')).toContain('dog')
  })

  it('reads a pack the host already decompressed', async () => {
    serve(packFile('en', { dog }, {}), { headers: { 'content-encoding': 'gzip' } })
    await downloadPack('en', 0, () => {})
    expect(await lookUpOffline('en', 'dog')).toContain('canine')
  })

  it('removes a pack', async () => {
    serve(gz(packFile('en', { dog }, {})))
    await downloadPack('en', 0, () => {})
    await removePack('en')
    expect(await lookUpOffline('en', 'dog')).toBeNull()
    expect(await installedPacks()).toEqual({})
  })

  it('leaves nothing behind when the download is wrong or cut short', async () => {
    serve(gz(packFile('en', { dog }, {}, { v: 99 })))
    await expect(downloadPack('en', 0, () => {})).rejects.toThrow()
    serve(gz(packFile('en', { dog }, {}, { lang: 'fr' })))
    await expect(downloadPack('en', 0, () => {})).rejects.toThrow()
    // the header promises more shards than arrive
    serve(gz(packFile('en', { dog }, {}, { shards: 5 })))
    await expect(downloadPack('en', 0, () => {})).rejects.toThrow()
    serve('nope', { status: 404 })
    await expect(downloadPack('en', 0, () => {})).rejects.toThrow()
    expect(await installedPacks()).toEqual({})
    expect(await lookUpOffline('en', 'dog')).toBeNull()
  })
})

describe('fetchPackList', () => {
  it('returns the manifest, or null when it cannot be had', async () => {
    serve(JSON.stringify({ en: { bytes: 5, words: 2, built: 'x' } }))
    expect(await fetchPackList()).toEqual({ en: { bytes: 5, words: 2, built: 'x' } })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    expect(await fetchPackList()).toBeNull()
  })
})
