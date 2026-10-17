/** a catalog entry: a plain string, or one string per plural form (selected by the `n` parameter) */
export type Message = string | { one?: string; two?: string; many?: string; other: string }
