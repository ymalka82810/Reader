export type Flow = 'scrolled' | 'paginated'
export type Theme = 'light' | 'sepia' | 'dark'

export interface Settings {
  fontSize: number // px
  lineHeight: number
  flow: Flow
  theme: Theme
  fontFamily: 'default' | 'serif' | 'sans'
  justify: boolean
  /** wider letter/word/line spacing, left-aligned sans text: easier for dyslexia and low vision */
  accessible: boolean
  /** animate page turns with a smooth slide instead of an instant jump */
  pageTransition: boolean
}

const DEFAULTS: Settings = {
  fontSize: 20,
  lineHeight: 1.7,
  flow: 'scrolled',
  theme: 'light',
  fontFamily: 'default',
  justify: false,
  accessible: false,
  pageTransition: true,
}

const KEY = 'reader:settings'

export function loadSettings(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return DEFAULTS
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* ignore */
  }
}

const THEMES: Record<Theme, { bg: string; fg: string; link: string }> = {
  light: { bg: '#ffffff', fg: '#1a1a1a', link: '#0b57d0' },
  sepia: { bg: '#f4ecd8', fg: '#433422', link: '#8a4b08' },
  dark: { bg: '#121212', fg: '#e4e4e4', link: '#8ab4f8' },
}

export const themeColors = (t: Theme) => THEMES[t]

const FAMILIES = {
  default: '',
  serif: `font-family: "Frank Ruhl Libre", "David", "Times New Roman", serif !important;`,
  sans: `font-family: "Heebo", "Arial", "Helvetica", sans-serif !important;`,
}

/** CSS injected into every book section. Font size is forced on <html> and inherited downward
 *  so publisher px/em sizes don't block resizing. */
export function bookCSS(s: Settings): string {
  const c = THEMES[s.theme]
  const a = s.accessible
  return `
    html {
      font-size: ${s.fontSize}px !important;
      color: ${c.fg} !important;
      background: ${c.bg} !important;
      ${a ? FAMILIES.sans : FAMILIES[s.fontFamily]}
      ${a ? 'letter-spacing: 0.05em !important; word-spacing: 0.16em !important;' : ''}
    }
    body { font-size: 1em !important; color: ${c.fg} !important; background: transparent !important; }
    p, li, blockquote, dd, div, span:not([class*="sup"]), td, a, em, i, b, strong {
      font-size: inherit !important;
    }
    p, li, blockquote, dd {
      line-height: ${a ? Math.max(s.lineHeight, 1.9) : s.lineHeight} !important;
      text-align: ${s.justify && !a ? 'justify' : 'start'};
      ${a ? 'margin-block: 0.9em;' : ''}
    }
    a:link, a:visited { color: ${c.link} !important; }
    img, svg { max-width: 100% !important; height: auto !important; }
    pre { white-space: pre-wrap !important; }
  `
}
