// The clues the identification weighs a name by, each a source it checks the name against (see bookLookup's weigh).
// New clues go last: the model learnt on the device (identifyModel) keeps its weights by this order.

export const CLUES = [
  'name',
  'meta',
  'copyright',
  'list',
  'names',
  'words',
  'sequel',
  'catalog',
  'order',
  'running',
  'cover',
  'page',
  'years',
  'rhythm',
  'neighbour',
  'house',
  'design',
  'debut',
  'joint',
  'timeline',
  'make',
  'length',
] as const

/** where a clue comes from: the file's or library's name, the file's package, the copyright page, a list of the series'
 *  books, the names its story shares with the series, a catalog, the numbers the library leaves free, a running head,
 *  the books before and after it (both of them saying so: `sequel`; one only: `neighbour`), the publisher, translator
 *  and ISBN block it shares with the series (`house`), its cover's design (`design`), the order its words first appear
 *  in the series (`debut`), the whole series placed at once (`joint`), the years the author wrote in (`timeline`), how
 *  the file was made (`make`), and the length of the books along the series (`length`) */
export type Clue = (typeof CLUES)[number]

/** the clues that count toward a sure name before anything is learnt about them */
export const STRONG: readonly Clue[] = ['name', 'meta', 'copyright', 'list', 'names', 'sequel', 'catalog', 'page']

/** the clues that speak against only weakly: what they say against keeps no name from being saved, until the user's answers
 *  show them right */
export const WEAK_AGAINST: readonly Clue[] = ['timeline']
