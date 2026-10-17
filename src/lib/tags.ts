import type { BookMeta } from './db'
import { localeTag } from '../i18n'

export interface Tag {
  /** identity ignoring case and nikud/accents */
  key: string
  name: string
  count: number
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim()
export const tagKey = (name: string) => name.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('he')

/** Splits what the user typed ("a, b ; c") into tags: trimmed, no empties, one per key (the first spelling wins). */
export function parseTags(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of text.split(/[,;،\n]/)) {
    const name = clean(part).replace(/^#/, '')
    const key = tagKey(name)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out
}

export const hasTag = (b: Pick<BookMeta, 'tags'>, key: string) => !!b.tags?.some((n) => tagKey(n) === key)

/** Every tag in use with how many books carry it, alphabetically. */
export function listTags(books: Pick<BookMeta, 'tags'>[]): Tag[] {
  const map = new Map<string, Tag>()
  for (const b of books)
    for (const name of b.tags ?? []) {
      const key = tagKey(name)
      const tag = map.get(key)
      if (tag) tag.count++
      else map.set(key, { key, name, count: 1 })
    }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, localeTag()))
}
