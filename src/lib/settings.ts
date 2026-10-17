import { CUSTOM_FONT_FAMILY } from './customFont'

export type Flow = 'scrolled' | 'paginated'
export type Theme = 'light' | 'sepia' | 'dark' | 'custom'

export interface Settings {
  fontSize: number // px
  lineHeight: number
  flow: Flow
  theme: Theme
  /** key of FONTS, or 'custom' for the uploaded font */
  fontFamily: string
  /** extra letter spacing in em (0 = the book's own) */
  letterSpacing: number
  /** text column width in px, 0 = default */
  columnWidth: number
  /** side margin as a percentage of the page width */
  margin: number
  /** screen brightness multiplier, 1 = unchanged */
  brightness: number
  /** colors of the 'custom' theme */
  customBg: string
  customFg: string
  customLink: string
  justify: boolean
  /** wider letter/word/line spacing, left-aligned sans text: easier for dyslexia and low vision */
  accessible: boolean
  /** animate page turns with a smooth slide instead of an instant jump */
  pageTransition: boolean
  /** Wiktionary edition used by the dictionary lookup; 'auto' follows the book's language */
  dictLang: string
  /** daily reading goal in minutes; 0 means no goal */
  dailyGoalMin: number
}

export const DICT_LANGS: [string, string][] = [
  ['he', 'עברית'],
  ['en', 'English'],
  ['ar', 'العربية'],
  ['ru', 'Русский'],
  ['fr', 'Français'],
  ['de', 'Deutsch'],
  ['es', 'Español'],
]

const prefers = (q: string) => typeof matchMedia === 'function' && matchMedia(q).matches

/** defaults follow the OS: dark theme in dark mode, no animated page turns with reduced motion */
const defaults = (): Settings => ({
  ...DEFAULTS,
  theme: prefers('(prefers-color-scheme: dark)') ? 'dark' : 'light',
  pageTransition: !prefers('(prefers-reduced-motion: reduce)'),
})

const DEFAULTS: Settings = {
  fontSize: 20,
  lineHeight: 1.7,
  flow: 'scrolled',
  theme: 'light',
  fontFamily: 'default',
  letterSpacing: 0,
  columnWidth: 0,
  margin: 5,
  brightness: 1,
  customBg: '#fdf6e3',
  customFg: '#2b2b2b',
  customLink: '#1a5fb4',
  justify: false,
  accessible: false,
  pageTransition: true,
  dictLang: 'auto',
  dailyGoalMin: 0,
}

const KEY = 'reader:settings'

export function loadSettings(): Settings {
  try {
    return { ...defaults(), ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return defaults()
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* localStorage unavailable or full: the setting just won't persist */
  }
}

type Colors = { bg: string; fg: string; link: string }
const THEMES: Record<Exclude<Theme, 'custom'>, Colors> = {
  light: { bg: '#ffffff', fg: '#1a1a1a', link: '#0b57d0' },
  sepia: { bg: '#f4ecd8', fg: '#433422', link: '#8a4b08' },
  dark: { bg: '#121212', fg: '#e4e4e4', link: '#8ab4f8' },
}

export const themeColors = (s: Settings): Colors =>
  s.theme === 'custom' ? { bg: s.customBg, fg: s.customFg, link: s.customLink } : THEMES[s.theme]

const stack = (families: string) => `font-family: ${families} !important;`

/** fonts offered in the settings table; each row previews its own font */
export const FONTS: Record<string, { label: string; family: string }> = {
  default: { label: 'ברירת מחדל', family: '' },
  serif: { label: 'סריף', family: '"Frank Ruhl Libre", "David", "Times New Roman", serif' },
  sans: { label: 'סנס', family: '"Heebo", "Arial", "Helvetica", sans-serif' },
  david: { label: 'דוד', family: '"David", "David Libre", "Times New Roman", serif' },
  miriam: { label: 'מרים', family: '"Miriam", "Miriam Libre", "Arial", sans-serif' },
  tahoma: { label: 'Tahoma', family: '"Tahoma", "Verdana", sans-serif' },
  georgia: { label: 'Georgia', family: '"Georgia", "Times New Roman", serif' },
  mono: { label: 'מונו', family: '"Courier New", "Consolas", monospace' },
}

const fontCSS = (key: string, hasCustom: boolean) =>
  key === 'custom' ? (hasCustom ? stack(`"${CUSTOM_FONT_FAMILY}", sans-serif`) : '') : (FONTS[key]?.family ? stack(FONTS[key].family) : '')

/** CSS injected into every book section. Font size is forced on <html> and inherited downward
 *  so publisher px/em sizes don't block resizing. */
export function bookCSS(s: Settings, customFace = ''): string {
  const c = themeColors(s)
  const a = s.accessible
  return `
    ${customFace}
    html {
      font-size: ${s.fontSize}px !important;
      color: ${c.fg} !important;
      background: ${c.bg} !important;
      ${a ? stack(FONTS.sans!.family) : fontCSS(s.fontFamily, !!customFace)}
      ${a ? `letter-spacing: ${Math.max(s.letterSpacing, 0.05)}em !important; word-spacing: 0.16em !important;` : s.letterSpacing ? `letter-spacing: ${s.letterSpacing}em !important;` : ''}
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

/** column width and side margins, applied as paginator attributes */
export function applyLayout(r: { setAttribute?: (k: string, v: string) => void; removeAttribute?: (k: string) => void }, s: Settings) {
  r.setAttribute?.('gap', `${s.margin}%`)
  if (s.columnWidth > 0) r.setAttribute?.('max-inline-size', `${s.columnWidth}px`)
  else r.removeAttribute?.('max-inline-size')
}
