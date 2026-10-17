import { Select } from '../Select'
import { t } from '../../i18n'

export type Filter = 'all' | 'reading' | 'unread' | 'finished'
export type Sort = 'recent' | 'title' | 'author' | 'added'

const FILTERS: [Filter, string][] = [
  ['all', t('filter.all')],
  ['reading', t('filter.reading')],
  ['unread', t('filter.unread')],
  ['finished', t('filter.finished')],
]
const SORTS: [Sort, string][] = [
  ['recent', t('sort.recent')],
  ['added', t('sort.added')],
  ['title', t('sort.title')],
  ['author', t('sort.author')],
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
        placeholder={t('lib.searchPlaceholder')}
        aria-label={t('lib.search')}
        value={query}
        onChange={(e) => onQuery(e.target.value)}
      />
      <Select
        label={t('filter.label')}
        value={filter}
        onChange={onFilter}
        options={FILTERS.map(([v, text]): [Filter, string] => [v, v === 'all' ? t('filter.allLabeled') : text])}
      />
      <Select label={t('sort.label')} value={sort} onChange={onSort} options={SORTS} />
    </div>
  )
}
