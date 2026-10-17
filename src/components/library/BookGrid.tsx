import { useState } from 'react'
import { isFinished, setFinished, type BookMeta } from '../../lib/db'
import { Cover } from './Cover'

export type BookActions = {
  selecting: boolean
  onOpen: (id: string) => void
  onToggle: (id: string) => void
  onEdit: (b: BookMeta) => void
  onMove: (b: BookMeta) => void
  onDelete: (b: BookMeta) => void
  refresh: () => void
}

type CardProps = BookActions & { book: BookMeta; picked: boolean }

/** one book's card with its "⋯" actions menu */
export function BookCard({ book: b, picked, selecting, onOpen, onToggle, onEdit, onMove, onDelete, refresh }: CardProps) {
  const [menu, setMenu] = useState(false)
  const close = () => setMenu(false)
  return (
    <li>
      <button
        className={'card' + (picked ? ' selected' : '')}
        aria-pressed={selecting ? picked : undefined}
        onClick={() => (selecting ? onToggle(b.id) : onOpen(b.id))}
      >
        <div className="cover-wrap">
          <Cover book={b} />
          {isFinished(b) ? (
            <span className="done-badge" aria-label="נקרא">✓</span>
          ) : (
            !!b.fraction && (
              <progress className="cover-progress" value={b.fraction} max={1} aria-label={`${Math.round(b.fraction * 100)}% נקרא`} />
            )
          )}
        </div>
        <div className="meta">
          <strong>{b.title}</strong>
          {b.author && <small>{b.author}</small>}
          <small className="kind">{b.fromPdf ? 'PDF' : b.kind.toUpperCase()}</small>
        </div>
      </button>
      {selecting ? (
        <span className="sel-mark" aria-hidden="true">{picked ? '☑' : '☐'}</span>
      ) : (
        <>
          <button
            className="more-btn"
            aria-label="פעולות לספר"
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            ⋯
          </button>
          {menu && (
            <>
              <div className="menu-backdrop" onClick={close} />
              <div className="menu card-menu" role="menu" tabIndex={-1} autoFocus onKeyDown={(e) => e.key === 'Escape' && close()}>
                <button
                  role="menuitem"
                  onClick={async () => {
                    close()
                    await setFinished(b.id, !isFinished(b))
                    refresh()
                  }}
                >
                  {isFinished(b) ? 'סמן כלא נקרא' : 'סמן כנקרא'}
                </button>
                <button role="menuitem" onClick={() => { close(); onEdit(b) }}>עריכת שם ומחבר</button>
                <button role="menuitem" onClick={() => { close(); onMove(b) }}>העבר לתיקייה</button>
                <div className="menu-sep" role="separator" />
                <button role="menuitem" className="danger-item" onClick={() => { close(); onDelete(b) }}>מחק</button>
              </div>
            </>
          )}
        </>
      )}
    </li>
  )
}

export function BookGrid({ books, selected, ...actions }: BookActions & { books: BookMeta[]; selected: Set<string> }) {
  return (
    <ul className="grid">
      {books.map((b) => (
        <BookCard key={b.id} book={b} picked={selected.has(b.id)} {...actions} />
      ))}
    </ul>
  )
}
