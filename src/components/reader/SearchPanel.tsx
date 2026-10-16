import { MAX_SEARCH_RESULTS, type SearchGroup } from './useBookSearch'
import { Panel } from './shared'

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
    <Panel label="חיפוש בספר" className="search">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onSearch(query)
        }}
      >
        <input
          type="search"
          placeholder="חיפוש בספר…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          autoFocus
        />
        {searching ? (
          <button type="button" onClick={onCancel}>
            עצור
          </button>
        ) : (
          <button type="submit" disabled={!query.trim()}>
            חפש
          </button>
        )}
      </form>
      {searching && <p className="muted">מחפש…</p>}
      {capped && <p className="muted">מוצגות {MAX_SEARCH_RESULTS} התוצאות הראשונות. צמצמו את החיפוש כדי לראות עוד.</p>}
      {!searching && query.trim() && results.length === 0 && <p className="muted">לא נמצאו תוצאות.</p>}
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
