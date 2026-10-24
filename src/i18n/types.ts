/** a catalog entry: a plain string, or one string per plural form (selected by the `n` parameter) */
export type Message = string | { zero?: string; one?: string; two?: string; few?: string; many?: string; other: string }
