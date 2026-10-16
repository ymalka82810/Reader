import type { FoliateTocItem } from 'foliate-js/view.js'

export type FlatTocItem = FoliateTocItem & { depth: number }

export const flattenToc = (items: FoliateTocItem[] | null | undefined, depth = 0): FlatTocItem[] =>
  (items ?? []).flatMap((i) => [{ ...i, depth }, ...flattenToc(i.subitems, depth + 1)])
