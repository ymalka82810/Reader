import { beforeEach, describe, expect, it } from 'vitest'
import { decryptBlob, encryptBlob, isEncrypted, PasswordRequiredError, WrongPasswordError } from './encrypt'
import { deleteBook, getBook, listBooks, saveBook } from './db'
import { exportLibrary, importLibrary } from './backup'

const FAST = 1000 // PBKDF2 rounds; the default is deliberately slow

describe('encryptBlob', () => {
  it('round-trips, including an empty blob and one spanning several chunks', async () => {
    for (const size of [0, 5, 2.5 * 1024 * 1024]) {
      const bytes = Uint8Array.from({ length: size }, (_, i) => (i * 31) & 255)
      const enc = await encryptBlob(new Blob([bytes]), 'pw', FAST)
      expect(await isEncrypted(enc)).toBe(true)
      const dec = new Uint8Array(await (await decryptBlob(enc, 'pw')).arrayBuffer())
      expect(dec.length).toBe(bytes.length)
      expect(dec.every((b, i) => b === bytes[i])).toBe(true)
    }
  })
  it('does not leak the plaintext', async () => {
    const enc = await encryptBlob(new Blob(['secret-title']), 'pw', FAST)
    expect(await enc.text()).not.toContain('secret-title')
  })
  it('rejects a wrong password', async () => {
    const enc = await encryptBlob(new Blob(['x']), 'right', FAST)
    await expect(decryptBlob(enc, 'wrong')).rejects.toBeInstanceOf(WrongPasswordError)
  })
  it('detects truncation and tampering', async () => {
    const big = await encryptBlob(new Blob([new Uint8Array(2.5 * 1024 * 1024)]), 'pw', FAST)
    await expect(decryptBlob(big.slice(0, big.size - 1024 * 1024), 'pw')).rejects.toBeInstanceOf(WrongPasswordError)
    const bytes = new Uint8Array(await big.arrayBuffer())
    bytes[100] = bytes[100]! ^ 1
    await expect(decryptBlob(new Blob([bytes]), 'pw')).rejects.toBeInstanceOf(WrongPasswordError)
  })
  it('does not mistake a plain backup for an encrypted one', async () => {
    expect(await isEncrypted(new Blob([new Uint8Array([10, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8])]))).toBe(false)
  })
})

describe('encrypted backup', () => {
  beforeEach(async () => {
    for (const b of await listBooks()) await deleteBook(b.id)
  })
  it('restores with the password and asks for one otherwise', async () => {
    await saveBook({
      id: 'a', title: 'T', author: 'A', kind: 'epub', file: new Blob(['content']), fileName: 'a.epub', addedAt: 1,
    })
    const blob = await exportLibrary(undefined, 'pw')
    expect(await isEncrypted(blob)).toBe(true)
    await deleteBook('a')

    await expect(importLibrary(blob)).rejects.toBeInstanceOf(PasswordRequiredError)
    await expect(importLibrary(blob, undefined, 'nope')).rejects.toBeInstanceOf(WrongPasswordError)
    expect(await importLibrary(blob, undefined, 'pw')).toEqual({ restored: 1, skipped: 0 })
    expect(await (await getBook('a'))!.file.text()).toBe('content')
  })
})
