import { ImportError } from './errors'
import type { ExtractedPdf } from './pdfToBook'
import { t } from '../i18n'

const CHAPTER_CHARS = 20000

const SNIFF_BYTES = 65536

/** a file that is not text (a renamed image, an executable, an archive) has NUL bytes or many other control characters
 *  in its first bytes; real text, in UTF-8 or Windows-1255, has none */
function looksBinary(buf: ArrayBuffer): boolean {
  const b = new Uint8Array(buf, 0, Math.min(buf.byteLength, SNIFF_BYTES))
  let control = 0
  for (const c of b) {
    if (c === 0) return true
    if (c < 9 || (c > 13 && c < 32 && c !== 27)) control++
  }
  return b.length > 0 && control / b.length > 0.02
}

/** UTF-8 when valid, otherwise Windows-1255 (the usual encoding of old Hebrew .txt files) */
function decode(buf: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    return new TextDecoder('windows-1255').decode(buf)
  }
}

/** Turn a plain-text file into the same shape the PDF importer produces, so it goes through buildEpub. */
export async function extractTxt(file: File): Promise<ExtractedPdf> {
  const buf = await file.arrayBuffer()
  if (looksBinary(buf)) throw new ImportError(t('import.notText'))
  const text = decode(buf).replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const blocks = text.split(/\n\s*\n/)
  // files with one line per paragraph and no blank lines
  const raw = blocks.length > 1 ? blocks : text.split('\n')
  const paras = raw
    .map((b) => (blocks.length > 1 ? b.replace(/\s*\n\s*/g, ' ') : b).trim())
    .filter(Boolean)
  if (!paras.length) throw new ImportError(t('import.empty'))

  const letters = text.match(/\p{L}/gu) ?? []
  const hebrew = letters.filter((c) => /[֐-׿]/.test(c)).length
  const title = file.name.replace(/\.[^.]+$/, '')

  const chapters: ExtractedPdf['chapters'] = []
  let cur: string[] = []
  let size = 0
  for (const p of paras) {
    cur.push(p)
    size += p.length
    if (size >= CHAPTER_CHARS) {
      chapters.push({ title: t('book.part', { n: chapters.length + 1 }), paras: cur })
      cur = []
      size = 0
    }
  }
  if (cur.length) chapters.push({ title: t('book.part', { n: chapters.length + 1 }), paras: cur })
  if (chapters.length === 1 && chapters[0]) chapters[0].title = title

  return { title, author: '', rtl: hebrew > letters.length / 3, pageCount: 0, chapters }
}
