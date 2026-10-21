/** words in a piece of text: runs of letters or digits, so Hebrew, Latin and punctuation-glued text all count alike */
export const countWords = (text: string) => text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0

/** words in a book that was just converted (PDF, TXT, DOCX): counted from the text the converter already has,
 *  instead of opening the finished book again and walking every chapter */
export const wordsOfExtracted = (x: { chapters: { paras: string[] }[] }) =>
  x.chapters.reduce((n, c) => n + c.paras.reduce((m, p) => m + countWords(p), 0), 0)

/** lets the page draw and handle a tap between two heavy steps of a long conversion */
export const tick = () => new Promise<void>((r) => setTimeout(r, 0))

interface Countable {
  sections?: { linear?: string; createDocument?: () => Document | Promise<Document> }[]
}

/** words in the reading text of a book opened by foliate-js; sections without a document (images, PDF pages) add none */
export async function wordsOfBook(book: Countable, signal?: AbortSignal): Promise<number> {
  let n = 0
  for (const s of book.sections ?? []) {
    signal?.throwIfAborted() // a cancelled import stops counting at once
    if (s.linear === 'no' || !s.createDocument) continue
    try {
      n += countWords((await s.createDocument()).body?.textContent ?? '')
    } catch {
      /* an unreadable section does not stop the count */
    }
  }
  return n
}

/** opens a stored book file just to count its words */
export async function wordsOfFile(file: File | Blob): Promise<number> {
  const { makeBook } = await import('foliate-js/view.js')
  const book = await makeBook(file)
  try {
    return await wordsOfBook(book)
  } finally {
    book.destroy?.()
  }
}
