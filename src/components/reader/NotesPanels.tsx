import type { Annotation } from '../../lib/db'
import { COLOR_NAMES, HIGHLIGHT_COLORS } from './colors'
import { Panel } from './shared'

export function NotesPanel({
  notes,
  onGoTo,
  onEdit,
  onRemove,
  onExport,
}: {
  notes: Annotation[]
  onGoTo: (cfi: string) => void
  onEdit: (id: string) => void
  onRemove: (id: string) => void
  onExport: () => void
}) {
  return (
    <Panel label="סימניות והדגשות">
      <h3>סימניות והדגשות</h3>
      {notes.length > 0 && <button onClick={onExport}>ייצוא ל-Markdown</button>}
      {notes.length === 0 && <p className="muted">אין עדיין. סמן טקסט כדי להדגיש אותו, או לחץ על 🔖 כדי לשמור מקום.</p>}
      <ul className="notes">
        {[...notes]
          .sort((a, b) => a.createdAt - b.createdAt)
          .map((n) => (
            <li key={n.id}>
              <button className="note-main" onClick={() => onGoTo(n.cfi)}>
                <span className="note-kind" style={{ background: n.kind === 'bookmark' ? 'transparent' : n.color }}>
                  {n.kind === 'bookmark' ? '🔖' : ''}
                </span>
                <span>
                  {n.text}
                  {n.note && <small className="note-text">{n.note}</small>}
                </span>
              </button>
              {n.kind === 'highlight' && (
                <button aria-label="ערוך" onClick={() => onEdit(n.id)}>
                  ✎
                </button>
              )}
              <button aria-label="מחק" onClick={() => onRemove(n.id)}>✕</button>
            </li>
          ))}
      </ul>
    </Panel>
  )
}

export function EditNotePanel({
  note,
  onUpdate,
  onRemove,
  onClose,
}: {
  note: Annotation
  onUpdate: (patch: Partial<Annotation>) => void
  onRemove: () => void
  onClose: () => void
}) {
  return (
    <Panel label="עריכת הדגשה" className="edit">
      <blockquote style={{ borderColor: note.color }}>{note.text}</blockquote>
      <textarea
        placeholder="הוסף הערה…"
        value={note.note ?? ''}
        onChange={(e) => onUpdate({ note: e.target.value })}
        rows={4}
        autoFocus
      />
      <div className="row">
        {HIGHLIGHT_COLORS.map((c, i) => (
          <button
            key={c}
            className={'swatch' + (c === note.color ? ' on' : '')}
            style={{ background: c }}
            aria-label={`צבע ${COLOR_NAMES[i]}`}
            aria-pressed={c === note.color}
            onClick={() => onUpdate({ color: c })}
          />
        ))}
        <span style={{ flex: 1 }} />
        <button onClick={onRemove}>מחק</button>
        <button className="primary" onClick={onClose}>סיום</button>
      </div>
    </Panel>
  )
}
