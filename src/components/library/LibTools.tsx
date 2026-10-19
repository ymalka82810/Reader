import { useState } from 'react'
import { Select } from '../Select'
import { t } from '../../i18n'
import type { Tag } from '../../lib/tags'
import { isFiltering, NO_FILTER, SMARTS, typeLabel, type LibraryFilter, type ReadState, type Smart } from '../../lib/libraryFilter'

export type Sort = 'recent' | 'title' | 'author' | 'added' | 'longest'

const FILTERS: [ReadState, string][] = [
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

const ANY = '*'

type Props = {
  query: string
  onQuery: (q: string) => void
  filter: LibraryFilter
  onFilter: (f: LibraryFilter) => void
  /** file types present in the library; the type picker is hidden when there is only one */
  types: string[]
  /** folders present in the library; the folder picker is hidden when there is only one */
  folders: { key: string; name: string }[]
  onPickBooks: () => void
  sort: Sort
  onSort: (s: Sort) => void
  /** tags in use; the picker is hidden when there are none */
  tags: Tag[]
  /** key of the tag being filtered by, '' = any */
  tag: string
  onTag: (key: string) => void
  list: boolean
  onList: (list: boolean) => void
  /** folders listed above the single books (true) or below them */
  foldersFirst: boolean
  onFoldersFirst: (first: boolean) => void
}

/** search box with the filter, tag and sort pickers right under it */
export function LibTools({ query, onQuery, filter, onFilter, types, folders, onPickBooks, sort, onSort, tags, tag, onTag, list, onList, foldersFirst, onFoldersFirst }: Props) {
  const [showMore, setShowMore] = useState(false)
  const activeMore = (filter.type ? 1 : 0) + (filter.folder !== undefined ? 1 : 0) + (filter.ids.size ? 1 : 0)
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
        value={filter.state}
        onChange={(state) => onFilter({ ...filter, state })}
        options={FILTERS.map(([v, text]): [ReadState, string] => [v, v === 'all' ? t('filter.allLabeled') : text])}
      />
      <button type="button" className="select-btn" aria-expanded={showMore} onClick={() => setShowMore((v) => !v)}>
        <span>{activeMore ? t('filter.moreN', { n: activeMore }) : t('filter.more')}</span>
        <svg viewBox="0 0 12 8" width="12" height="8" aria-hidden="true">
          <path d={showMore ? 'M1 6.5l5-5 5 5' : 'M1 1.5l5 5 5-5'} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        type="button"
        className="select-btn"
        title={t('folders.position')}
        onClick={() => onFoldersFirst(!foldersFirst)}
      >
        <span>{foldersFirst ? t('folders.top') : t('folders.bottom')}</span>
        <svg viewBox="0 0 12 8" width="12" height="8" aria-hidden="true">
          <path d={foldersFirst ? 'M1 6.5l5-5 5 5' : 'M1 1.5l5 5 5-5'} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <Select
        label={t('smart.label')}
        value={filter.smart || ANY}
        onChange={(v) => onFilter({ ...filter, smart: v === ANY ? '' : (v as Smart) })}
        options={[[ANY, t('smart.none')], ...SMARTS.map((x): [string, string] => [x, x === 'stale' ? t('smart.stale') : t('smart.longest')])]}
      />
      {tags.length > 0 && (
        <Select
          label={t('tag.filterLabel')}
          value={tag}
          onChange={onTag}
          options={[['', t('tag.filterAll')], ...tags.map((x): [string, string] => [x.key, t('tag.option', { name: x.name, n: x.count })])]}
        />
      )}
      {isFiltering(filter) && (
        <button type="button" className="select-btn" onClick={() => onFilter(NO_FILTER)}>
          {t('filter.clear')}
        </button>
      )}
      <Select label={t('sort.label')} value={sort} onChange={onSort} options={SORTS} />
      <button
        type="button"
        className="select-btn view-toggle"
        aria-pressed={list}
        aria-label={t('view.list')}
        title={t('view.list')}
        onClick={() => onList(!list)}
      >
        {list ? '☰' : '▦'}
      </button>
      {showMore && (
        <div className="lib-tools-more">
          {types.length > 1 && (
            <Select
              label={t('filter.type')}
              value={filter.type || ANY}
              onChange={(v) => onFilter({ ...filter, type: v === ANY ? '' : v })}
              options={[[ANY, t('filter.allTypes')], ...types.map((x): [string, string] => [x, typeLabel(x)])]}
            />
          )}
          {folders.length > 1 && (
            <Select
              label={t('filter.folder')}
              value={filter.folder === undefined ? ANY : `k:${filter.folder}`}
              onChange={(v) => onFilter({ ...filter, folder: v === ANY ? undefined : v.slice(2) })}
              options={[[ANY, t('filter.allFolders')], ...folders.map((f): [string, string] => [`k:${f.key}`, f.name || t('filter.noAuthor')])]}
            />
          )}
          <button type="button" className="select-btn" onClick={onPickBooks}>
            {filter.ids.size ? t('filter.pickedN', { n: filter.ids.size }) : t('filter.pick')}
          </button>
        </div>
      )}
    </div>
  )
}
