// The identification's own small model, trained on the device from the user's answers (no server, no download): a
// logistic regression over the clues. For a name found it takes which clues agree with it and which speak against it,
// and gives the chance that the user keeps the name. Every answer (approved, corrected, turned down) is one training
// step, so it tunes itself to the library it actually meets. It starts from the weights the fixed rules implied, and
// it only decides once it has learnt from enough answers, including wrong names; until then it stays out of the way.
// It can only make the identification more careful (a name is saved without asking only if the model also trusts it).

import { CLUES, STRONG, WEAK_AGAINST, type Clue } from './clues'

const KEY = 'reader:identify:model'

/** answers needed before the model decides, and how many of them were wrong names */
const READY_ANSWERS = 30
const READY_WRONG = 3
/** the chance below which a name is not saved without asking */
const BAR = 0.85
const RATE = 0.4
const DECAY = 40
const L2 = 0.002

type Model = { w: number[]; n: number; wrong: number }

/** bias, then for each clue "agrees", then for each clue "speaks against" */
const SIZE = 1 + CLUES.length * 2

/** the weights the fixed rules implied: strong clues count, weak ones less, any clue against counts heavily against */
function start(): Model {
  const w = [0.5, ...CLUES.map((c) => (STRONG.includes(c) ? 1 : 0.3)), ...CLUES.map((c) => (WEAK_AGAINST.includes(c) ? -0.5 : -1.5))]
  return { w, n: 0, wrong: 0 }
}

function load(): Model {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Model | null
    if (v && Array.isArray(v.w) && v.w.every((x) => Number.isFinite(x))) {
      if (v.w.length === SIZE) return v
      // a model learnt before clues were added (the newest come last): what it learnt is kept, and each new clue starts
      // from the weight the rules give it
      const old = (v.w.length - 1) / 2
      if (Number.isInteger(old) && old < CLUES.length) {
        const s = start().w
        const w = [v.w[0]!, ...CLUES.map((_, i) => (i < old ? v.w[1 + i]! : s[1 + i]!)), ...CLUES.map((_, i) => (i < old ? v.w[1 + old + i]! : s[1 + CLUES.length + i]!))]
        return { ...v, w }
      }
    }
  } catch {
    /* unreadable: start again from the rules */
  }
  return start()
}

function features(evidence: readonly Clue[], conflicts: readonly Clue[]): number[] {
  const x = new Array<number>(SIZE).fill(0)
  x[0] = 1
  for (const c of new Set(evidence)) {
    const i = CLUES.indexOf(c)
    if (i >= 0) x[1 + i] = 1
  }
  for (const c of new Set(conflicts)) {
    const i = CLUES.indexOf(c)
    if (i >= 0) x[1 + CLUES.length + i] = 1
  }
  return x
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z))
const dot = (w: number[], x: number[]) => w.reduce((s, wi, i) => s + wi * x[i]!, 0)

/** the chance that the user keeps a name with these clues */
export function predict(evidence: readonly Clue[] = [], conflicts: readonly Clue[] = []): number {
  return sigmoid(dot(load().w, features(evidence, conflicts)))
}

/** one answer of the user: `right` when the name was kept (as offered, or in the same place) */
export function learnAnswer(evidence: readonly Clue[] = [], conflicts: readonly Clue[] = [], right: boolean) {
  if (!evidence.length && !conflicts.length) return
  const m = load()
  const x = features(evidence, conflicts)
  const err = (right ? 1 : 0) - sigmoid(dot(m.w, x))
  const rate = RATE / (1 + m.n / DECAY)
  m.w = m.w.map((wi, i) => wi + rate * (err * x[i]! - (i === 0 ? 0 : L2 * wi)))
  m.n++
  if (!right) m.wrong++
  try {
    localStorage.setItem(KEY, JSON.stringify(m))
  } catch {
    /* storage unavailable: learnt until the app closes at most */
  }
}

/** whether the model has learnt enough (answers, and wrong names among them) to decide */
export function modelReady(m: Model = load()): boolean {
  return m.n >= READY_ANSWERS && m.wrong >= READY_WRONG
}

/** whether a name with these clues may be saved without asking: always before the model is ready, after it only
 *  when the chance that the user keeps it is high enough */
export function modelAllows(evidence: readonly Clue[] = [], conflicts: readonly Clue[] = []): boolean {
  const m = load()
  return !modelReady(m) || sigmoid(dot(m.w, features(evidence, conflicts))) >= BAR
}

/** how much the model has learnt, for the stats */
export function modelReport() {
  const m = load()
  return { answers: m.n, wrong: m.wrong, ready: modelReady(m) }
}
