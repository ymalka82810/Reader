import { compare as cfiCompare } from 'foliate-js/epubcfi.js'
import type { Annotation } from '../../lib/db'
import type { ExportFormat } from '../../lib/notesExport'
import { COLOR_NAMES, HIGHLIGHT_COLORS } from './colors'
import { Panel } from './shared'
import { t } from '../../i18n'

export function NotesList({
  notes,
  onGoTo,
  onGotoBookmark,
  onEdit,
  onRemove,
  onExport,
}: {
  notes: Annotation[]
  onGoTo: (cfi: string) => void
  onGotoBookmark: (dir: 1 | -1) => void
  onEdit: (id: string) => void
  onRemove: (id: string) => void
  onExport: (format: ExportFormat) => void
}) {
  if (notes.length === 0) return <p className="muted">{t('notes.empty')}</p>
  return (
    <>
      <div className="notes-tools">
        {notes.some((n) => n.kind === 'bookmark') && (
          <>
            <button onClick={() => onGotoBookmark(-1)} title={t('notes.prevTitle')}>{t('notes.prev')}</button>
            <button onClick={() => onGotoBookmark(1)} title={t('notes.nextTitle')}>{t('notes.next')}</button>
          </>
        )}
        <button onClick={() => onExport('markdown')}>{t('notes.exportMarkdown')}</button>
        <button onClick={() => onExport('obsidian')}>{t('notes.exportObsidian')}</button>
        <button onClick={() => onExport('pdf')}>{t('notes.exportPdf')}</button>
      </div>
      <ul className="notes">
        {[...notes]
          .sort((a, b) => cfiCompare(a.cfi, b.cfi))
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
                <button aria-label={t('common.edit')} onClick={() => onEdit(n.id)}>
                  ✎
                </button>
              )}
              <button aria-label={t('common.delete')} onClick={() => onRemove(n.id)}>✕</button>
            </li>
          ))}
      </ul>
    </>
  )
}

export function EditNotePanel({
  note,
  onUpdate,
  onRemove,
  onShare,
  onClose,
}: {
  note: Annotation
  onUpdate: (patch: Partial<Annotation>) => void
  onRemove: () => void
  onShare: () => void
  onClose: () => void
}) {
  return (
    <Panel label={t('notes.editTitle')} className="edit">
      <blockquote style={{ borderColor: note.color }}>{note.text}</blockquote>
      <textarea
        placeholder={t('notes.placeholder')}
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
            aria-label={t('notes.color', { color: COLOR_NAMES[i] ?? '' })}
            aria-pressed={c === note.color}
            onClick={() => onUpdate({ color: c })}
          />
        ))}
        <span style={{ flex: 1 }} />
        <button onClick={onShare}>{t('common.share')}</button>
        <button onClick={onRemove}>{t('common.delete')}</button>
        <button className="primary" onClick={onClose}>{t('common.done')}</button>
      </div>
    </Panel>
  )
}
