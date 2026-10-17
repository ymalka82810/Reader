export type Filter = 'all' | 'reading' | 'unread' | 'finished'
export type Sort = 'recent' | 'title' | 'author' | 'added'

const FILTERS: [Filter, string][] = [
  ['all', 'הכול'],
  ['reading', 'בקריאה'],
  ['unread', 'לא התחלתי'],
  ['finished', 'נקראו'],
]
const SORTS: [Sort, string][] = [
  ['recent', 'נפתח לאחרונה'],
  ['added', 'נוסף לאחרונה'],
  ['title', 'שם (א–ת)'],
  ['author', 'מחבר (א–ת)'],
]

type Props = {
  query: string
  onQuery: (q: string) => void
  filter: Filter
  onFilter: (f: Filter) => void
  sort: Sort
  onSort: (s: Sort) => void
}

/** search box with the filter and sort pickers right under it */
export function LibTools({ query, onQuery, filter, onFilter, sort, onSort }: Props) {
  return (
    <div className="lib-tools">
      <input
        type="search"
        placeholder="חיפוש לפי שם או מחבר…"
        aria-label="חיפוש בספרייה"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
      />
      <select aria-label="סינון" value={filter} onChange={(e) => onFilter(e.target.value as Filter)}>
        {FILTERS.map(([v, text]) => (
          <option key={v} value={v}>
            {v === 'all' ? 'סינון: הכול' : text}
          </option>
        ))}
      </select>
      <select aria-label="מיון" value={sort} onChange={(e) => onSort(e.target.value as Sort)}>
        {SORTS.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </div>
  )
}
