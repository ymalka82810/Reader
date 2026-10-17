import 'fake-indexeddb/auto'
import { setLocale } from '../i18n'

// the suite asserts on the Hebrew UI strings, whatever language the machine running it uses
setLocale('he')

// minimal in-memory localStorage (the lib code only needs get/set/remove)
const data = new Map<string, string>()
if (typeof localStorage === 'undefined') globalThis.localStorage = {
  getItem: (k: string) => data.get(k) ?? null,
  setItem: (k: string, v: string) => void data.set(k, String(v)),
  removeItem: (k: string) => void data.delete(k),
  clear: () => data.clear(),
  key: (i: number) => [...data.keys()][i] ?? null,
  get length() {
    return data.size
  },
} as Storage
