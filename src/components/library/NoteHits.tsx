import { MAX_NOTE_HITS, type NoteHit, type Snippet } from '../../lib/noteSearch'
import { t } from '../../i18n'
import { shownName } from '../../lib/bookName'

const Marked = ({ parts }: { parts: Snippet }) => (
  <>
    {parts.map((p, i) => (p.hit ? <mark key={i}>{p.s}</mark> : p.s))}
  </>
)

/** highlights and notes from every book that match the library search; a tap opens the book at that spot */
export function NoteHits({ hits, onOpen }: { hits: NoteHit[]; onOpen: (id: string, cfi: string) => void }) {
  if (!hits.length) return null
  return (
    <section className="note-hits" aria-label={t('lib.noteHits')}>
      <h2>{t('lib.noteHits')}</h2>
      {hits.length >= MAX_NOTE_HITS && <p className="muted">{t('lib.noteHitsCapped', { n: MAX_NOTE_HITS })}</p>}
      <ul className="notes">
        {hits.map(({ book, note, text, comment }) => (
          <li key={`${book.id}:${note.id}`}>
            <button className="note-main" onClick={() => onOpen(book.id, note.cfi)}>
              <span className="note-kind" style={{ background: note.color }} />
              <span>
                <small className="note-book">{shownName(book.title)}</small>
                <Marked parts={text} />
                {comment && (
                  <small className="note-text">
                    <Marked parts={comment} />
                  </small>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
