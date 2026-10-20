/** letters, digits and Hebrew niqqud/cantillation marks count as part of a word */
const WORD_CHAR = /[\p{L}\p{N}\p{M}'"״׳-]/u

/** start/end offsets of the word around `offset` in `text`, or null when it falls on a gap */
export function wordBounds(text: string, offset: number): { start: number; end: number } | null {
  let at = Math.min(Math.max(offset, 0), text.length)
  // a caret just after the last letter still belongs to that word
  if (!WORD_CHAR.test(text[at] ?? '') && at > 0 && WORD_CHAR.test(text[at - 1] ?? '')) at -= 1
  if (!WORD_CHAR.test(text[at] ?? '')) return null
  let start = at
  let end = at + 1
  while (start > 0 && WORD_CHAR.test(text[start - 1] ?? '')) start -= 1
  while (end < text.length && WORD_CHAR.test(text[end] ?? '')) end += 1
  return { start, end }
}

type DocWithCaret = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  caretRangeFromPoint?: (x: number, y: number) => Range | null
}

/** the word under a point (iframe coordinates), as a Range, or null when there is no text there */
export function wordRangeAt(doc: Document, x: number, y: number): Range | null {
  const d = doc as DocWithCaret
  let node: Node | null = null
  let offset = 0
  const pos = d.caretPositionFromPoint?.(x, y)
  if (pos) {
    node = pos.offsetNode
    offset = pos.offset
  } else {
    const r = d.caretRangeFromPoint?.(x, y)
    if (r) {
      node = r.startContainer
      offset = r.startOffset
    }
  }
  if (!node || node.nodeType !== Node.TEXT_NODE) return null
  const b = wordBounds(node.textContent ?? '', offset)
  if (!b) return null
  const range = doc.createRange()
  range.setStart(node, b.start)
  range.setEnd(node, b.end)
  return range
}

/** first non-transparent background colour from `el` up to the root, else the host page's */
function pageBackground(el: Element | null, doc: Document): string {
  const win = doc.defaultView
  for (let e = el; e && win; e = e.parentElement) {
    const c = win.getComputedStyle(e).backgroundColor
    if (c && c !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(c)) return c
  }
  return getComputedStyle(document.body).backgroundColor || '#fff'
}

export interface PinchPreview {
  /** show the anchor word at `scale` times its real size (1 = unchanged) and label it with `fontSize` */
  update: (scale: number, fontSize: number) => void
  remove: () => void
}

/**
 * A floating copy of the word under the pinch, drawn over the page in the host document so the
 * reader can see how big the text will get without re-laying-out the whole chapter on every move.
 * Returns null when there is no word under the fingers.
 */
export function createPinchPreview(doc: Document, range: Range, frame: { left: number; top: number }): PinchPreview | null {
  const rect = range.getBoundingClientRect()
  const text = range.toString()
  const host = range.startContainer.parentElement
  const win = doc.defaultView
  if (!text || !host || !win || rect.width === 0 || rect.height === 0) return null
  const cs = win.getComputedStyle(host)

  const box = document.createElement('div')
  box.setAttribute('aria-hidden', 'true')
  box.className = 'pinch-preview'
  Object.assign(box.style, {
    left: `${frame.left + rect.left}px`,
    top: `${frame.top + rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    background: pageBackground(host, doc),
    color: cs.color,
    fontFamily: cs.fontFamily,
    fontWeight: cs.fontWeight,
    fontStyle: cs.fontStyle,
    fontSize: cs.fontSize,
    lineHeight: `${rect.height}px`,
    direction: cs.direction,
  })
  const word = document.createElement('span')
  word.className = 'pinch-preview-word'
  word.textContent = text
  const label = document.createElement('span')
  label.className = 'pinch-preview-label'
  box.append(word, label)
  document.body.append(box)

  return {
    update: (scale, fontSize) => {
      word.style.transform = `scale(${scale})`
      label.textContent = String(fontSize)
    },
    remove: () => box.remove(),
  }
}
