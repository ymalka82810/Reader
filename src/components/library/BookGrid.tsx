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
  return (
    <ul className="grid">
      {books.map((b) => (
        <li key={b.id}>
          <button
            className={'card' + (selected.has(b.id) ? ' selected' : '')}
            aria-pressed={selecting ? selected.has(b.id) : undefined}
            onClick={() => (selecting ? onToggle(b.id) : onOpen(b.id))}
          >
            <Cover book={b} />
            <div className="meta">
              <strong>{b.title}</strong>
              {b.author && <small>{b.author}</small>}
              <small className="kind">
                {b.fromPdf ? 'PDF' : b.kind.toUpperCase()}
                {b.fraction ? ` · ${Math.round(b.fraction * 100)}%` : ''}
                {isFinished(b) ? ' · נקרא ✓' : ''}
              </small>
            </div>
          </button>
          {selecting ? (
            <span className="sel-mark" aria-hidden="true">{selected.has(b.id) ? '☑' : '☐'}</span>
          ) : (
            <>
              <button
                className={'fin' + (isFinished(b) ? ' on' : '')}
                aria-label={isFinished(b) ? 'סמן כלא נקרא' : 'סמן כנקרא'}
                aria-pressed={isFinished(b)}
                onClick={async () => {
                  await setFinished(b.id, !isFinished(b))
                  refresh()
                }}
              >
                ✓
              </button>
              <button className="edit-btn" aria-label="עריכת שם ומחבר" onClick={() => onEdit(b)}>
                ✎
              </button>
              <button className="folder-btn" aria-label="העבר לתיקייה" onClick={() => onMove(b)}>
                📁
              </button>
              <button className="del" aria-label="מחק" onClick={() => onDelete(b)}>
                ✕
              </button>
            </>
          )}
        </li>
      ))}
    </ul>
  )
}
