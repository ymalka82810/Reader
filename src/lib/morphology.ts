// Guesses at the dictionary form of a word as it stands in running text. Hebrew and Arabic glue prepositions, the article
// and conjunctions to the front of a word and pronouns and person endings to its back, so "וכשהלכתי" or "وبكتابها" is
// never a headword. The guesses are cheap string surgery, not an analysis: the caller keeps only those the dictionary
// actually has, so a wrong guess costs nothing but a lookup.
import { normalizeWord } from './dictPackFormat'

/** a guess and how many changes it took from the word as written; fewer changes are tried first */
type Candidate = { word: string; cost: number }

const MAX_COST = 3
const MAX_CANDIDATES = 300
/** a guess shorter than this is too likely to be some unrelated short word */
const MIN_STEM = 2

type Step = (s: string) => string[]
/** a change and what it costs: taking a verb's tense prefix off is likelier to be wrong than taking a preposition off */
type Rule = [step: Step, cost: number]

/** every word reachable from `start` within MAX_COST, each rule used at most once and in the given order */
function expand(start: string, rules: Rule[], emit: (s: string) => string): Candidate[] {
  const best = new Map<string, number>()
  const walk = (s: string, from: number, cost: number) => {
    const out = emit(s)
    if (out.length >= MIN_STEM && (best.get(out) ?? Infinity) > cost) best.set(out, cost)
    if (cost >= MAX_COST) return
    for (let i = from; i < rules.length; i++) {
      const [step, extra] = rules[i]!
      if (cost + extra > MAX_COST) continue
      for (const next of step(s)) if (next.length >= MIN_STEM) walk(next, i + 1, cost + extra)
    }
  }
  walk(start, 0, 0)
  best.delete(emit(start))
  return [...best]
    .map(([word, cost]) => ({ word, cost }))
    .sort((a, b) => a.cost - b.cost || b.word.length - a.word.length)
    .slice(0, MAX_CANDIDATES)
}

// ---------- Hebrew ----------

const TO_FINAL: Record<string, string> = { כ: 'ך', מ: 'ם', נ: 'ן', פ: 'ף', צ: 'ץ' }
const FROM_FINAL: Record<string, string> = { ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' }
/** the work is done on the word with plain letters only; the final letter takes its final form when a guess is emitted */
const plainHe = (s: string) => s.replace(/[ךםןףץ]/g, (c) => FROM_FINAL[c]!)
const finalHe = (s: string) => s.slice(0, -1) + (TO_FINAL[s.at(-1)!] ?? s.at(-1)!)

/** ו, then ש or כש or מש or לכש, then ב/כ/ל/מ, then ה: "וכשה", "ומה", "שב", "לה" */
const HE_PREFIXES = (() => {
  const out = new Set<string>()
  for (const a of ['', 'ו']) for (const b of ['', 'ש', 'כש', 'מש', 'לכש']) for (const c of ['', 'ב', 'כ', 'ל', 'מ']) for (const d of ['', 'ה']) out.add(a + b + c + d)
  out.delete('')
  return [...out]
})()

/** endings of nouns (plural, possessive pronouns) and of verbs (person and number), on plain letters */
const HE_SUFFIXES = [
  'ותיהמ', 'ותיהנ', 'ותיכמ', 'ותינו', 'ותיו', 'ותיה', 'ותיכ', 'ותי',
  'יהמ', 'יהנ', 'יכמ', 'יכנ', 'ינו', 'יו', 'יה', 'יכ',
  'תמ', 'תנ', 'תי', 'נו', 'נה', 'הו', 'המ', 'הנ', 'כמ', 'כנ',
  'ימ', 'ות', 'ית',
  'י', 'כ', 'ו', 'ה', 'ת', 'מ', 'נ',
]

const stripPrefixes = (prefixes: string[]): Step => (s) => prefixes.filter((p) => s.startsWith(p)).map((p) => s.slice(p.length))

/** the ending goes, and the stem gets back what the ending replaced: the ה of a feminine or of a ל״ה verb ("מלכתו" → "מלכה", "ראיתי" → "ראה") */
const heSuffix: Step = (s) => {
  const out: string[] = []
  for (const x of HE_SUFFIXES) {
    if (!s.endsWith(x) || s.length - x.length < MIN_STEM) continue
    const t = s.slice(0, -x.length)
    out.push(t, t + 'ה')
    if (t.endsWith('ת') || t.endsWith('י')) out.push(t.slice(0, -1) + 'ה')
  }
  return out
}

/**
 * The marks of a verb's tense and pattern: the person prefix of the future (א/ת/י/נ, "יכתבו"), the מ of a present that the
 * dictionary writes with ה ("מתלבש" → "התלבש"), and a first letter that a pattern drops ("אלך" → "הלך", "ישב").
 */
const heVerb: Step = (s) => {
  const out: string[] = []
  const first = s[0]!
  const rest = s.slice(1)
  if ('אתינ'.includes(first)) {
    out.push(rest, 'ה' + rest, 'י' + rest)
    if (rest[0] === 'י' || rest[0] === 'ו') out.push(rest.slice(1), 'נ' + rest.slice(1))
  }
  if (first === 'מ') out.push('ה' + rest)
  if (first === 'ה') out.push(rest)
  return out
}

/** full spelling against the dictionary's niqqud spelling: an extra ו or י inside the word ("כותב" → "כתב", "חיפש" → "חפש") */
const heSpelling: Step = (s) => {
  const out: string[] = []
  for (let i = 1; i < s.length - 1; i++) if (s[i] === 'ו' || s[i] === 'י') out.push(s.slice(0, i) + s.slice(i + 1))
  return out
}

const heCandidates = (word: string) => expand(
    plainHe(word),
    [[stripPrefixes(HE_PREFIXES), 1], [heVerb, 1.5], [heSuffix, 1], [heSpelling, 1], [heSpelling, 1]],
    finalHe,
  )

// ---------- Arabic ----------

/** و/ف, then the future س or ب/ك/ل, then the article: "وبال", "فس", "لل" */
const AR_PREFIXES = (() => {
  const out = new Set<string>(['لل', 'ولل', 'فلل'])
  for (const a of ['', 'و', 'ف']) for (const b of ['', 'ب', 'ك', 'ل', 'س']) for (const c of ['', 'ال']) if (!(b === 'س' && c)) out.add(a + b + c)
  out.delete('')
  return [...out]
})()

const AR_SUFFIXES = ['كما', 'هما', 'تما', 'تم', 'تن', 'هم', 'هن', 'كم', 'كن', 'نا', 'ها', 'ني', 'ون', 'ين', 'ات', 'ان', 'وا', 'ية', 'ه', 'ك', 'ي', 'ت', 'ة', 'ا']

/** the ending goes, and a ت that was a ة before it ("مدرستها" → "مدرسة") turns back */
const arSuffix: Step = (s) => {
  const out: string[] = []
  for (const x of AR_SUFFIXES) {
    if (!s.endsWith(x) || s.length - x.length < MIN_STEM) continue
    const t = s.slice(0, -x.length)
    out.push(t, t + 'ة')
    if (t.endsWith('ت')) out.push(t.slice(0, -1) + 'ة')
  }
  return out
}

/** the person prefix of the present (ي/ت/ن/أ) */
const arVerb: Step = (s) => ('يتنأ'.includes(s[0]!) ? [s.slice(1)] : [])

/** a bare alef where the dictionary has a hamza on it, and ى/ي at the end */
const arSpelling: Step = (s) => {
  const out: string[] = []
  if ('اأإآ'.includes(s[0]!)) for (const a of 'اأإآ') if (a !== s[0]) out.push(a + s.slice(1))
  if (s.endsWith('ى')) out.push(s.slice(0, -1) + 'ي')
  if (s.endsWith('ي')) out.push(s.slice(0, -1) + 'ى')
  return out
}

const arCandidates = (word: string) => expand(word, [[stripPrefixes(AR_PREFIXES), 1], [arVerb, 1.5], [arSuffix, 1], [arSpelling, 1]], (s) => s)

/**
 * Likely dictionary forms of `word` (already without niqqud), fewest changes first, not including the word itself.
 * Only Hebrew and Arabic need this; the other languages' packs list the inflected forms themselves.
 */
export function baseCandidates(lang: string, word: string): Candidate[] {
  const w = normalizeWord(lang, word)
  if (lang === 'he' && /^[א-ת]+$/.test(w)) return heCandidates(w)
  if (lang === 'ar' && /^[ء-ي]+$/.test(w)) return arCandidates(w)
  return []
}
