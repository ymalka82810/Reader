import { MAX_SEARCH_RESULTS, type SearchGroup } from './useBookSearch'
import { Panel } from './shared'
import { t } from '../../i18n'

export function SearchPanel({
  query,
  onQueryChange,
  results,
  searching,
  capped,
  onSearch,
  onCancel,
  onGoTo,
}: {
  query: string
  onQueryChange: (q: string) => void
  results: SearchGroup[]
  searching: boolean
  capped: boolean
  onSearch: (q: string) => void
  onCancel: () => void
  onGoTo: (cfi: string) => void
}) {
  return (
    <Panel label={t('search.title')} className="search">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onSearch(query)
        }}
      >
        <input
          type="search"
          placeholder={t('search.placeholder')}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          autoFocus
        />
        {searching ? (
          <button type="button" onClick={onCancel}>
            {t('search.stop')}
          </button>
        ) : (
          <button type="submit" disabled={!query.trim()}>
            {t('search.go')}
          </button>
        )}
      </form>
      {searching && <p className="muted">{t('search.searching')}</p>}
      {capped && <p className="muted">{t('search.capped', { n: MAX_SEARCH_RESULTS })}</p>}
      {!searching && query.trim() && results.length === 0 && <p className="muted">{t('search.none')}</p>}
      <ul className="search-results">
        {results.map((group, gi) => (
          <li key={gi}>
            <strong>{group.label}</strong>
            <ul>
              {group.items.map((item, ii) => (
                <li key={ii}>
                  <button onClick={() => onGoTo(item.cfi)}>
                    {item.excerpt.pre}
                    <mark>{item.excerpt.match}</mark>
                    {item.excerpt.post}
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
