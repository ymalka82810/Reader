import { useRef, useState, type ReactNode } from 'react'
import { useBackGesture } from '../../hooks/useBackGesture'
import { isFinished, setFinished, type BookMeta } from '../../lib/db'
import { isKeptPdf } from '../../lib/pdfOcr'
import { Cover } from './Cover'
import { t } from '../../i18n'
import { menuKeyDown } from '../menuKeys'

export type BookActions = {
  selecting: boolean
  onOpen: (id: string) => void
  onToggle: (id: string) => void
  onEdit: (b: BookMeta) => void
  onMove: (b: BookMeta) => void
  /** saves this one book's file to the phone (a download in the browser) */
  onDownload: (b: BookMeta) => void
  /** sends this book through the phone's share sheet, in a format asked first */
  onShare: (b: BookMeta) => void
  /** reads a kept PDF (a scan) by OCR and turns it into a text book */
  onOcr: (b: BookMeta) => void
  onDelete: (b: BookMeta) => void
  refresh: () => void
}

type CardProps = BookActions & { book: BookMeta; picked: boolean; /** shown under the card (links to the author's shared books) */ extra?: ReactNode }

/** one book's card with its "⋯" actions menu */
export function BookCard({ book: b, picked, extra, selecting, onOpen, onToggle, onEdit, onMove, onDownload, onShare, onOcr, onDelete, refresh }: CardProps) {
  const [menu, setMenu] = useState(false)
  // the phone's back swipe closes the open menu first
  useBackGesture(() => setMenu(false), 3, menu)
  const more = useRef<HTMLButtonElement>(null)
  const close = (refocus = false) => {
    setMenu(false)
    if (refocus) more.current?.focus()
  }
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
            <span className="done-badge" aria-label={t('book.read')}>✓</span>
          ) : (
            !!b.fraction && (
              <progress className="cover-progress" value={b.fraction} max={1} aria-label={t('book.percentRead', { pct: Math.round(b.fraction * 100) })} />
            )
          )}
        </div>
        <div className="meta">
          <strong>{b.title}</strong>
          {b.author && <small>{b.author}</small>}
          <small className="kind">{b.fromPdf ? 'PDF' : b.kind === 'audio' ? t('audio.kind') : b.kind.toUpperCase()}</small>
          {!!b.tags?.length && <small className="tags">{b.tags.map((n) => `#${n}`).join(' ')}</small>}
        </div>
      </button>
      {extra}
      {selecting ? (
        <span className="sel-mark" aria-hidden="true">{picked ? '☑' : '☐'}</span>
      ) : (
        <>
          <button
            ref={more}
            className="more-btn"
            aria-label={t('book.actions')}
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            ⋯
          </button>
          {menu && (
            <>
              <div className="menu-backdrop" onClick={() => close()} />
              <div className="menu card-menu" role="menu" tabIndex={-1} autoFocus onKeyDown={(e) => menuKeyDown(e, () => close(true))}>
                <button
                  role="menuitem"
                  onClick={async () => {
                    close()
                    await setFinished(b.id, !isFinished(b))
                    refresh()
                  }}
                >
                  {isFinished(b) ? t('book.markUnread') : t('book.markRead')}
                </button>
                <button role="menuitem" onClick={() => { close(); onEdit(b) }}>{t('book.editMeta')}</button>
                <button role="menuitem" onClick={() => { close(); onMove(b) }}>{t('book.moveToFolder')}</button>
                <button role="menuitem" onClick={() => { close(); onDownload(b) }}>{t('book.saveToPhone')}</button>
                <button role="menuitem" onClick={() => { close(); onShare(b) }}>{t('book.share')}</button>
                {isKeptPdf(b) && <button role="menuitem" onClick={() => { close(); onOcr(b) }}>{t('book.ocr')}</button>}
                <div className="menu-sep" role="separator" />
                <button role="menuitem" className="danger-item" onClick={() => { close(); onDelete(b) }}>{t('common.delete')}</button>
              </div>
            </>
          )}
        </>
      )}
    </li>
  )
}

export function BookGrid({ books, selected, list, ...actions }: BookActions & { books: BookMeta[]; selected: Set<string>; list?: boolean }) {
  return (
    <ul className={'grid' + (list ? ' list' : '')}>
      {books.map((b) => (
        <BookCard key={b.id} book={b} picked={selected.has(b.id)} {...actions} />
      ))}
    </ul>
  )
}
