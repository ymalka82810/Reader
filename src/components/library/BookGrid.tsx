import { useState } from 'react'
import { isFinished, setFinished, type BookMeta } from '../../lib/db'
import { Cover } from './Cover'

type Props = {
  books: BookMeta[]
  selecting: boolean
  selected: Set<string>
  onOpen: (id: string) => void
  onToggle: (id: string) => void
  onEdit: (b: BookMeta) => void
  onMove: (b: BookMeta) => void
  onDelete: (b: BookMeta) => void
  refresh: () => void
}

export function BookGrid({ books, selecting, selected, onOpen, onToggle, onEdit, onMove, onDelete, refresh }: Props) {
  const [menuFor, setMenuFor] = useState<string>()
  const close = () => setMenuFor(undefined)
  return (
    <ul className="grid">
      {books.map((b) => (
        <li key={b.id}>
          <button
            className={'card' + (selected.has(b.id) ? ' selected' : '')}
            aria-pressed={selecting ? selected.has(b.id) : undefined}
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
            <span className="sel-mark" aria-hidden="true">{selected.has(b.id) ? '☑' : '☐'}</span>
          ) : (
            <>
              <button
                className="more-btn"
                aria-label="פעולות לספר"
                aria-haspopup="menu"
                aria-expanded={menuFor === b.id}
                onClick={() => setMenuFor(menuFor === b.id ? undefined : b.id)}
              >
                ⋯
              </button>
              {menuFor === b.id && (
                <>
                  <div className="menu-backdrop" onClick={close} />
                  <div className="menu card-menu" role="menu" onKeyDown={(e) => e.key === 'Escape' && close()}>
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
      ))}
    </ul>
  )
}
