import type { PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'

type Matrix = [number, number, number, number, number, number]

/** a × b: `b` applied first, then `a` (the order PDF's `cm` operator uses) */
function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ]
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

/** the area an image paints: it is drawn into the unit square, so the matrix's determinant is its size on the page */
const areaOf = (m: Matrix) => Math.abs(m[0] * m[3] - m[1] * m[2])

/** the few drawing operators that matter here; numbers come from pdf.js's OPS table */
export interface ImageOps {
  save: number
  restore: number
  transform: number
  formBegin: number
  formEnd: number
  images: Set<number>
}

/**
 * How much of the page its pictures cover (0 to 1+, panels placed side by side add up): a comic page is almost all
 * picture, a page of a scanned book is one too, which is why the text on the page has to be weighed as well.
 */
export function imageCoverage(fnArray: ArrayLike<number>, argsArray: ArrayLike<unknown>, ops: ImageOps, pageArea: number): number {
  if (!(pageArea > 0)) return 0
  let ctm = IDENTITY
  const stack: Matrix[] = []
  let covered = 0
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i]!
    const args = argsArray[i] as unknown
    if (fn === ops.save) stack.push(ctm)
    else if (fn === ops.restore) ctm = stack.pop() ?? ctm
    else if (fn === ops.transform && Array.isArray(args) && args.length >= 6) ctm = multiply(ctm, args.slice(0, 6) as Matrix)
    else if (fn === ops.formBegin) {
      stack.push(ctm)
      const m = Array.isArray(args) && Array.isArray(args[0]) && args[0].length >= 6 ? (args[0].slice(0, 6) as Matrix) : null
      if (m) ctm = multiply(ctm, m)
    } else if (fn === ops.formEnd) ctm = stack.pop() ?? ctm
    else if (ops.images.has(fn)) covered += areaOf(ctm)
  }
  return covered / pageArea
}

/** the picture coverage of one page, read from the operators pdf.js lists for drawing it */
export async function pageImageCoverage(
  page: PDFPageProxy,
  ops: Record<string, number>,
): Promise<number> {
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = page.view
  const list = await page.getOperatorList()
  const images = new Set(
    [ops.paintImageXObject, ops.paintInlineImageXObject, ops.paintImageXObjectRepeat, ops.paintJpegXObject, ops.paintImageMaskXObject].filter(
      (n): n is number => typeof n === 'number',
    ),
  )
  return imageCoverage(
    list.fnArray,
    list.argsArray,
    {
      save: ops.save!,
      restore: ops.restore!,
      transform: ops.transform!,
      formBegin: ops.paintFormXObjectBegin!,
      formEnd: ops.paintFormXObjectEnd!,
      images,
    },
    Math.abs((x1 - x0) * (y1 - y0)),
  )
}

/** a page is mostly picture when its images cover over this share of it */
const PICTURE_SHARE = 0.55
/** a page of a scanned book with a text layer carries about a thousand characters; speech balloons and captions, far fewer */
const COMIC_MAX_CHARS = 350

/** a comic page: pictures over most of it and only a little lettering on top (a scan with text recognised has a lot of text) */
export const isPictorialPage = (coverage: number, chars: number) => coverage >= PICTURE_SHARE && chars <= COMIC_MAX_CHARS

/** a comic (or picture book): at least half of its pages are pictorial; converting it to text would throw the drawings away */
export const looksLikeComic = (pictorial: boolean[]) => pictorial.length > 0 && pictorial.filter(Boolean).length >= pictorial.length / 2
