import { useId } from 'react'

// The splash screen's book with turning pages (see #splash in index.html), for any wait that is
// more than a moment: the whole library loading, opening a book, converting or importing files.
// The styles are the `.book-loader` ones in styles.css; with reduced motion the book stands still.
type Props = {
  /** the book's width, as a CSS length (default 7rem) */
  size?: string
  /** the book beside its text, small, for a notice in the page rather than a wait of its own */
  inline?: boolean
  /** the visible text under the book; omit for the book alone (the caller then labels it) */
  label?: string
}

const LINES_R = [
  [240, 166, 50], [236, 190, 54], [240, 214, 86], [236, 238, 90], [268, 262, 58],
] as const
const LINES_L = [
  [110, 166, 82], [106, 190, 86], [118, 214, 74], [106, 238, 86], [138, 262, 54],
] as const

const PAGE_L = 'M216 142 C 186 118, 146 110, 104 114 C 96 115, 92 120, 92 128 L 92 290 C 92 298, 97 303, 105 302 C 146 298, 186 306, 216 328 Z'
const PAGE_R = 'M216 142 C 246 118, 286 110, 328 114 C 336 115, 340 120, 340 128 L 340 290 C 340 298, 335 303, 327 302 C 286 298, 246 306, 216 328 Z'
// the hard cover under the open pages (left and right board), as in public/icon.svg
const COVER_L = 'M216 156 C 182 132, 138 126, 84 130 C 76 131, 72 136, 72 144 L 72 314 C 72 322, 77 327, 85 326 C 138 322, 182 330, 216 354 Z'
const COVER_R = 'M216 156 C 250 132, 294 126, 348 130 C 356 131, 360 136, 360 144 L 360 314 C 360 322, 355 327, 347 326 C 294 322, 250 330, 216 354 Z'
// the page block's thickness: sheets stacked under each page, the lower the further out and darker
const SHEETS = [[16, '#D9CBAE'], [13, '#E2D5BA'], [10, '#EADFC7'], [7, '#F0E7D3'], [4, '#F6EFDF']] as const
// the whole book sits this much higher in the icon, so the cover and the page block stay centered
const BOOK_SHIFT = 'translate(0 -14)'

function Lines({ rows, opacity }: { rows: readonly (readonly [number, number, number])[]; opacity: number }) {
  return (
    <g fill="#2B4A7E" opacity={opacity}>
      {rows.map(([x, y, w]) => <rect key={y} x={x} y={y} width={w} height={9} rx={4.5} />)}
    </g>
  )
}

function Leaf({ pageL, pageR }: { pageL: string; pageR: string }) {
  return (
    <div className="bl-leaf">
      <div className="bl-face">
        <svg viewBox="92 110 124 220" preserveAspectRatio="none">
          <path d={PAGE_L} fill={pageL} />
          <Lines rows={LINES_L} opacity={0.5} />
        </svg>
      </div>
      <div className="bl-face bl-back">
        <svg viewBox="216 110 124 220" preserveAspectRatio="none">
          <path d={PAGE_R} fill={pageR} />
          <Lines rows={LINES_R} opacity={0.85} />
        </svg>
      </div>
    </div>
  )
}

export function BookLoader({ size, inline, label }: Props) {
  // gradient ids must be unique per instance, or a hidden copy would break the others' fills
  const id = useId().replace(/[^a-zA-Z0-9]/g, '')
  const ref = (name: string) => `url(#bl${name}${id})`
  return (
    <div className={inline ? 'book-loader compact' : 'book-loader'} style={size ? ({ '--bl-size': size } as React.CSSProperties) : undefined}>
      <div className="bl-icon" aria-hidden="true">
        <svg viewBox="0 0 432 432">
          <defs>
            <linearGradient id={`blBg${id}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#1E3A6B" /><stop offset="0.55" stopColor="#15294D" /><stop offset="1" stopColor="#0E1B33" /></linearGradient>
            <radialGradient id={`blGlow${id}`} cx="0.5" cy="0.42" r="0.6"><stop offset="0" stopColor="#4C7FD1" stopOpacity="0.38" /><stop offset="1" stopColor="#4C7FD1" stopOpacity="0" /></radialGradient>
            <linearGradient id={`blPageR${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FFFDF7" /><stop offset="1" stopColor="#F0E7D6" /></linearGradient>
            <linearGradient id={`blPageL${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FBF6EA" /><stop offset="1" stopColor="#E6DCC6" /></linearGradient>
            <linearGradient id={`blRibbon${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#F2B01E" /><stop offset="1" stopColor="#D98A09" /></linearGradient>
            <linearGradient id={`blCoverL${id}`} x1="1" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7A2230" /><stop offset="1" stopColor="#9C3442" /></linearGradient>
            <linearGradient id={`blCoverR${id}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#7A2230" /><stop offset="1" stopColor="#A63A48" /></linearGradient>
            <filter id={`blSh${id}`} x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="7" stdDeviation="9" floodColor="#0B1B33" floodOpacity="0.35" /></filter>
          </defs>
          <rect width="432" height="432" fill={ref('Bg')} />
          <rect width="432" height="432" fill={ref('Glow')} />
          <g transform={BOOK_SHIFT}>
          <g filter={ref('Sh')}>
            <path d={COVER_L} transform="translate(0 6)" fill="#3A0E17" />
            <path d={COVER_R} transform="translate(0 6)" fill="#3A0E17" />
            <path d={COVER_L} fill={ref('CoverL')} />
            <path d={COVER_R} fill={ref('CoverR')} />
            <path d="M204 344 Q 216 362, 228 344 L 228 352 Q 216 370, 204 352 Z" fill="#4A121D" />
          </g>
          {SHEETS.map(([k, fill]) => (
            <g key={k} fill={fill} stroke="#C4B391" strokeWidth="1.2">
              <path d={PAGE_L} transform={`translate(${-k * 0.45} ${k})`} />
              <path d={PAGE_R} transform={`translate(${k * 0.45} ${k})`} />
            </g>
          ))}
          <g filter={ref('Sh')}>
            <path d={PAGE_L} fill={ref('PageL')} />
            <path d={PAGE_R} fill={ref('PageR')} />
            <path d="M216 142 L216 328" stroke="#C9BB9E" strokeWidth="5" strokeLinecap="round" opacity="0.75" />
          </g>
          <Lines rows={LINES_R} opacity={0.85} />
          <Lines rows={LINES_L} opacity={0.5} />
          </g>
        </svg>
        <div className="bl-book">
          <Leaf pageL={ref('PageL')} pageR={ref('PageR')} />
          <Leaf pageL={ref('PageL')} pageR={ref('PageR')} />
          <Leaf pageL={ref('PageL')} pageR={ref('PageR')} />
        </div>
        <svg className="bl-ribbon" viewBox="0 0 432 432"><path d="M298 110 L334 110 L334 200 L316 181 L298 200 Z" transform={BOOK_SHIFT} fill={ref('Ribbon')} /></svg>
      </div>
      {label && <span className="bl-label">{label}</span>}
    </div>
  )
}
