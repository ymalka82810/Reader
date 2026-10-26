// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { describe, expect, it, vi } from 'vitest'
import { CbrError, cbrToCbz, isCbrName } from './cbrToCbz'

// the wasm is loaded by its URL in the browser; here that URL is read from the disk
vi.mock('node-unrar-js/esm/js/unrar.wasm?url', () => ({ default: 'file:///unrar.wasm' }))
const wasm = readFileSync('node_modules/node-unrar-js/esm/js/unrar.wasm')
vi.stubGlobal('fetch', async () => ({ arrayBuffer: async () => wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) }))

/** a real RAR made with the rar tool, when it is installed (skipped otherwise) */
function makeRar(): Buffer | undefined {
  try {
    const dir = mkdtempSync(join(tmpdir(), 'cbr-'))
    writeFileSync(join(dir, '001.jpg'), Buffer.from('page one'))
    writeFileSync(join(dir, '002.jpg'), Buffer.from('page two'))
    execFileSync('rar', ['a', '-ep', '-inul', join(dir, 'c.rar'), join(dir, '001.jpg'), join(dir, '002.jpg')])
    return readFileSync(join(dir, 'c.rar'))
  } catch {
    return undefined
  }
}

describe('cbrToCbz', () => {
  it('knows a CBR by its name, whatever the case', () => {
    expect(isCbrName('a.cbr')).toBe(true)
    expect(isCbrName('A v1.2.CBR')).toBe(true)
    expect(isCbrName('a.cbz')).toBe(false)
  })

  const rar = makeRar()
  it.skipIf(!rar)('repacks the pages of a RAR as a CBZ', async () => {
    const out = await cbrToCbz(new File([new Uint8Array(rar!)], 'Batman v1.12.CBR'))
    expect(out.name).toBe('batman v1.12.cbz')
    const zip = await JSZip.loadAsync(await out.arrayBuffer())
    expect(Object.keys(zip.files).sort()).toEqual(['001.jpg', '002.jpg'])
    expect(await zip.file('002.jpg')!.async('string')).toBe('page two')
  })

  it('refuses a file that is not a RAR', async () => {
    await expect(cbrToCbz(new File([new Uint8Array([1, 2, 3, 4])], 'x.cbr'))).rejects.toBeInstanceOf(CbrError)
  })
})
