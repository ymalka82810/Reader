/** Optional password protection for backup files.
 *
 *  Layout: [8-byte magic][16-byte PBKDF2 salt][4-byte nonce prefix][u32 iterations][u32 chunk size]
 *  followed by AES-256-GCM chunks (each `chunk size` plaintext bytes + 16-byte tag; the last may be shorter).
 *  Chunking keeps memory bounded for large libraries. The nonce is prefix + chunk index, and the
 *  "is last chunk" flag is authenticated, so reordering or truncating chunks fails to decrypt. */

const MAGIC = new TextEncoder().encode('RDRENC01')
const SALT_LEN = 16
const PREFIX_LEN = 4
const HEADER_LEN = MAGIC.length + SALT_LEN + PREFIX_LEN + 8
const TAG_LEN = 16
const CHUNK = 1024 * 1024
const DEFAULT_ITERATIONS = 600_000

/** thrown when a backup is encrypted and no password was given */
export class PasswordRequiredError extends Error {
  constructor() {
    super('הגיבוי מוצפן — נדרשת סיסמה')
    this.name = 'PasswordRequiredError'
  }
}

export class WrongPasswordError extends Error {
  constructor() {
    super('סיסמה שגויה, או שקובץ הגיבוי פגום')
    this.name = 'WrongPasswordError'
  }
}

export async function isEncrypted(file: Blob): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, MAGIC.length).arrayBuffer())
  return head.length === MAGIC.length && MAGIC.every((b, i) => b === head[i])
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveKey',
  ])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

function nonce(prefix: Uint8Array, index: number): Uint8Array<ArrayBuffer> {
  const n = new Uint8Array(12)
  n.set(prefix, 0)
  const view = new DataView(n.buffer)
  view.setUint32(4, Math.floor(index / 2 ** 32))
  view.setUint32(8, index >>> 0)
  return n
}

const aad = (last: boolean) => new Uint8Array([last ? 1 : 0])

/** yields the encrypted file piece by piece, so a caller can stream it to disk without holding it all */
export async function* encryptChunks(
  plain: Blob,
  password: string,
  iterations = DEFAULT_ITERATIONS,
): AsyncGenerator<Uint8Array<ArrayBuffer>> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN))
  const prefix = crypto.getRandomValues(new Uint8Array(PREFIX_LEN))
  const key = await deriveKey(password, salt, iterations)

  const header = new Uint8Array(HEADER_LEN)
  header.set(MAGIC, 0)
  header.set(salt, MAGIC.length)
  header.set(prefix, MAGIC.length + SALT_LEN)
  const view = new DataView(header.buffer)
  view.setUint32(HEADER_LEN - 8, iterations, true)
  view.setUint32(HEADER_LEN - 4, CHUNK, true)

  yield header
  const total = Math.max(1, Math.ceil(plain.size / CHUNK))
  for (let i = 0; i < total; i++) {
    const data = await plain.slice(i * CHUNK, (i + 1) * CHUNK).arrayBuffer()
    const iv = nonce(prefix, i)
    yield new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(i === total - 1) }, key, data),
    )
  }
}

export async function encryptBlob(plain: Blob, password: string, iterations = DEFAULT_ITERATIONS): Promise<Blob> {
  const parts: BlobPart[] = []
  for await (const part of encryptChunks(plain, password, iterations)) parts.push(part)
  return new Blob(parts, { type: 'application/octet-stream' })
}

/** Opens an encrypted file for streaming: `size` is the plaintext length, `chunks` yields the plaintext piece by
 *  piece so a caller can consume it without ever holding the whole file. Decryption errors surface from `chunks`
 *  as WrongPasswordError. */
export async function decryptStream(
  enc: Blob,
  password: string,
): Promise<{ size: number; chunks: AsyncGenerator<Uint8Array<ArrayBuffer>> }> {
  const header = new Uint8Array(await enc.slice(0, HEADER_LEN).arrayBuffer())
  if (header.length < HEADER_LEN || !(await isEncrypted(enc))) throw new Error('קובץ גיבוי לא תקין')
  const salt = header.slice(MAGIC.length, MAGIC.length + SALT_LEN)
  const prefix = header.slice(MAGIC.length + SALT_LEN, HEADER_LEN - 8)
  const view = new DataView(header.buffer)
  const iterations = view.getUint32(HEADER_LEN - 8, true)
  const chunk = view.getUint32(HEADER_LEN - 4, true)
  if (!iterations || !chunk) throw new Error('קובץ גיבוי לא תקין')
  const key = await deriveKey(password, salt, iterations)

  const body = enc.size - HEADER_LEN
  const full = chunk + TAG_LEN
  const total = Math.max(1, Math.ceil(body / full))
  async function* chunks() {
    try {
      for (let i = 0; i < total; i++) {
        const start = HEADER_LEN + i * full
        const data = await enc.slice(start, start + full).arrayBuffer()
        const iv = nonce(prefix, i)
        yield new Uint8Array(
          await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad(i === total - 1) }, key, data),
        )
      }
    } catch {
      throw new WrongPasswordError()
    }
  }
  return { size: Math.max(0, body - total * TAG_LEN), chunks: chunks() }
}

export async function decryptBlob(enc: Blob, password: string): Promise<Blob> {
  const { chunks } = await decryptStream(enc, password)
  const parts: BlobPart[] = []
  for await (const part of chunks) parts.push(part)
  return new Blob(parts, { type: 'application/octet-stream' })
}
