// Reads a page of the Hebrew Wiktionary (he.wiktionary.org, CC BY-SA) into the same shape as a kaikki.org line, so the
// Hebrew dictionary pack gets Hebrew definitions, synonyms and antonyms. kaikki.org does not extract this edition, so
// scripts/build-dictionary-packs.mjs feeds the pages of its dump through here. Node runs this file straight from the
// script: keep it free of anything that is not erasable TypeScript, and import nothing but types.
import type { KaikkiLine } from './dictPackFormat'

/** the sections whose links are words related to the entry, and the field of a kaikki line they go to */
const RELATION_SECTIONS: Record<string, 'synonyms' | 'antonyms' | 'derived' | 'related'> = {
  'מילים נרדפות': 'synonyms',
  ניגודים: 'antonyms',
  נגזרות: 'derived',
  'ראו גם': 'related',
}

/** templates that label a definition (register, era, field) and show their argument, e.g. {{משלב|סלנג}} → (סלנג) */
const LABEL_WITH_ARG = new Set(['רובד', 'משלב', 'הקשר', 'תחום'])
/** the longest template name taken for a label when it has no argument, e.g. {{מקרא}} → (מקרא) */
const MAX_LABEL = 12

const NIQQUD = /[֑-ׇ]/
const NIQQUD_ALL = /[֑-ׇ]/g

/** innermost templates first, so a label inside another template is already plain text when the outer one is read */
function expandTemplates(text: string): string {
  const inner = /\{\{([^{}]*)\}\}/
  for (let guard = 0; guard < 200 && inner.test(text); guard++) {
    text = text.replace(inner, (_, body: string) => {
      const [name = '', ...args] = body.split('|').map((s) => s.trim())
      const plain = args.filter((a) => !a.includes('='))
      if (LABEL_WITH_ARG.has(name)) return plain.length ? `(${plain.join(', ')})` : ''
      if (!args.length && name.length <= MAX_LABEL && /^[א-ת"' ]+$/.test(name)) return `(${name})`
      return ''
    })
  }
  return text
}

/** wikitext of one line as the plain text a reader sees */
export function plainText(wikitext: string): string {
  let t = wikitext
    .replace(/<ref[^>]*\/>/g, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, '')
  t = expandTemplates(t)
  t = t
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/\[https?:[^\s\]]+\s*([^\]]*)\]/g, '$1')
    .replace(/'{2,}/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\(\s*\)/g, '')
    .trim()
  return t
}

/** the words a section links to, as shown: [[מצין|מצוין]] → מצוין; links to other namespaces are not words */
function linkedWords(section: string): string[] {
  const out: string[] = []
  for (const m of section.matchAll(/\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g)) {
    const target = m[1]!.trim()
    if (!target || target.includes(':')) continue
    const shown = (m[2] ?? target.split('#')[0]!).trim()
    if (shown && !out.includes(shown)) out.push(shown)
  }
  return out
}

/** a field of the {{ניתוח דקדוקי}} box */
function field(box: string, name: string): string {
  const m = new RegExp(`\\|\\s*${name}\\s*=([^|\\n]*)`).exec(box)
  return m ? m[1]!.replace(/\}+\s*$/, '').trim() : ''
}

/** the template that opens at `start`, up to its own closing braces (nested templates included); '' when none */
function templateAt(text: string, start: number): string {
  if (start < 0) return ''
  let depth = 0
  for (let i = start; i < text.length - 1; i++) {
    if (text[i] === '{' && text[i + 1] === '{') {
      depth++
      i++
    } else if (text[i] === '}' && text[i + 1] === '}') {
      depth--
      i++
      if (!depth) return text.slice(start, i + 1)
    }
  }
  return text.slice(start)
}

/**
 * The entries of one page: a page holds one entry per level-2 heading (==כֶּלֶב==), each with a grammar box, numbered
 * definitions (# …; #: lines are examples) and level-3 sections, some of which list related words.
 */
export function parseHeWiktionaryPage(wikitext: string): KaikkiLine[] {
  const lines: KaikkiLine[] = []
  const parts = wikitext.split(/^==(?!=)(.+?)==\s*$/m)
  for (let i = 1; i < parts.length; i += 2) {
    const word = plainText(parts[i]!).replace(/[()]/g, '').trim()
    const body = parts[i + 1] ?? ''
    if (!word || !/[א-ת]/.test(word)) continue
    const box = templateAt(body, body.indexOf('{{ניתוח דקדוקי'))
    const isVerb = box.startsWith('{{ניתוח דקדוקי לפועל')
    const binyan = plainText(field(box, 'בניין'))
    const pos = isVerb ? (binyan ? `פועל, בניין ${binyan}` : 'פועל') : plainText(field(box, 'חלק דיבר')).replace(/־/g, ' ') || 'ערך'

    const [definitions = '', ...sections] = body.split(/^===\s*(.+?)\s*===\s*$/m)
    const glosses = definitions
      .split('\n')
      .filter((l) => /^#(?![:*#])/.test(l))
      .map((l) => plainText(l.replace(/^#\s*/, '')))
      .filter((g) => g.replace(/\([^)]*\)/g, '').trim().length > 1)

    const line: KaikkiLine = { word, pos, senses: glosses.map((g) => ({ glosses: [g] })) }
    const forms: { form: string }[] = []
    const full = field(box, 'כתיב מלא').replace(/[[\]]/g, '')
    if (full && /^[א-ת]+$/.test(full)) forms.push({ form: full })
    // the inflections are written with niqqud (נ' גְּדוֹלָה, ר' גְּדוֹלִים); the unpointed words around them are labels
    for (const m of field(box, 'נטיות').matchAll(/[א-ת֑-ׇ]+/g)) if (NIQQUD.test(m[0]) && m[0].replace(NIQQUD, '').length >= 2) forms.push({ form: m[0] })
    if (forms.length) line.forms = forms
    for (let s = 0; s + 1 < sections.length; s += 2) {
      const kind = RELATION_SECTIONS[sections[s]!]
      if (kind) line[kind] = [...(line[kind] ?? []), ...linkedWords(sections[s + 1]!).map((w) => ({ word: w }))]
    }
    lines.push(line)
    // books are written in full spelling (אוויר) and the entry is titled in the niqqud spelling (אֲוִיר, without niqqud אויר):
    // the entry is filed under its full spelling too, so a word found in a book reaches it rather than another dictionary's
    if (full && full !== word.replace(NIQQUD_ALL, '')) lines.push({ ...line, word: full, forms: [{ form: word, tags: ['canonical'] }] })
  }
  return lines
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

/**
 * The article pages of a MediaWiki XML dump, read line by line: a stream of lines in, and `onPage` called with the
 * wikitext of every page in the main namespace.
 */
export async function readDumpPages(lines: AsyncIterable<string>, onPage: (title: string, text: string) => void) {
  let title = ''
  let ns = ''
  let text: string[] | null = null
  const unescape = (s: string) => s.replace(/&(lt|gt|amp|quot|apos|#\d+);/g, (_, e: string) => (e[0] === '#' ? String.fromCodePoint(Number(e.slice(1))) : ENTITIES[e]!))
  for await (const raw of lines) {
    if (text) {
      const end = raw.indexOf('</text>')
      text.push(end >= 0 ? raw.slice(0, end) : raw)
      if (end >= 0) {
        if (ns === '0') onPage(title, unescape(text.join('\n')))
        text = null
      }
      continue
    }
    const t = /<title>(.*)<\/title>/.exec(raw)
    if (t) title = unescape(t[1]!)
    const n = /<ns>(\d+)<\/ns>/.exec(raw)
    if (n) ns = n[1]!
    const open = /<text[^>]*?(\/)?>(.*)$/.exec(raw)
    if (open && !open[1]) {
      const rest = open[2]!
      const end = rest.indexOf('</text>')
      if (end >= 0) {
        if (ns === '0') onPage(title, unescape(rest.slice(0, end)))
      } else text = [rest]
    }
  }
}
