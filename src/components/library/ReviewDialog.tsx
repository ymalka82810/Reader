import { useEffect, useState } from 'react'
import { Dialog } from '../Dialog'
import { t } from '../../i18n'
import { getAllNotes, type BookMeta } from '../../lib/db'
import {
  buildCards,
  dueCards,
  listWords,
  loadCardStates,
  nextState,
  removeWord,
  saveCardState,
  type Card,
  type CardState,
} from '../../lib/flashcards'

type Session = { queue: Card[]; total: number; states: Map<string, CardState>; all: number }

/** flashcards from the words looked up in the dictionary and the highlights, scheduled in boxes (see lib/flashcards) */
export function ReviewDialog({ books, onClose }: { books: BookMeta[]; onClose: () => void }) {
  const [session, setSession] = useState<Session>()
  const [failed, setFailed] = useState(false)
  const [shown, setShown] = useState(false)
  const [known, setKnown] = useState(0)

  useEffect(() => {
    Promise.all([listWords(), getAllNotes(), loadCardStates()]).then(
      ([words, notes, states]) => {
        const cards = buildCards(words, notes, books)
        const queue = dueCards(cards, states, Date.now())
        setSession({ queue, total: queue.length, states, all: cards.length })
      },
      (e) => {
        console.error(e)
        setFailed(true)
      },
    )
  }, [books])

  const card = session?.queue[0]

  const advance = (cardId: string, again: boolean) => {
    setShown(false)
    setSession((s) => {
      if (!s) return s
      // a forgotten card comes round once more in this sitting
      const rest = s.queue.slice(1)
      const done = s.queue.find((c) => c.id === cardId)
      return { ...s, queue: again && done ? [...rest, done] : rest }
    })
  }

  const rate = (c: Card, remembered: boolean) => {
    const next = nextState(session?.states.get(c.id), remembered, Date.now())
    session?.states.set(c.id, next)
    saveCardState(c.id, next).catch(console.error)
    if (remembered) setKnown((n) => n + 1)
    advance(c.id, !remembered)
  }

  const drop = (c: Card) => {
    removeWord(c.id.slice(2)).catch(console.error)
    setSession((s) => s && { ...s, all: s.all - 1, total: s.total - 1 })
    advance(c.id, false)
  }

  const position = session ? Math.min(session.total, session.total - session.queue.length + 1) : 0

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <Dialog
        className="modal review"
        role="dialog"
        aria-modal="true"
        aria-label={t('review.title')}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <h2>{t('review.title')}</h2>
        {failed ? (
          <p>{t('review.failed')}</p>
        ) : !session ? (
          <p>{t('common.loading')}</p>
        ) : session.all === 0 ? (
          <p className="muted">{t('review.empty')}</p>
        ) : !card ? (
          <>
            <p role="status">
              {session.total === 0 ? t('review.caughtUp') : t('review.done', { known, total: session.total })}
            </p>
            <p className="muted">{t('review.cards', { n: session.all })}</p>
          </>
        ) : (
          <>
            <progress value={position - 1} max={session.total} aria-label={t('review.progress')} />
            <small className="muted">
              {position}/{session.total} · {card.kind === 'word' ? t('review.word') : t('review.highlight')}
            </small>
            <div className="review-card" lang={card.lang} dir="auto">
              <div className={'review-front' + (card.kind === 'word' ? ' word' : '')}>{card.front}</div>
              {shown && card.back && <div className="review-back">{card.back}</div>}
              {shown && card.source && <small className="muted">{card.source}</small>}
            </div>
          </>
        )}
        <div className="modal-actions">
          {card && !shown && (
            <button className="primary" onClick={() => setShown(true)} autoFocus>
              {t('review.show')}
            </button>
          )}
          {card && shown && (
            <>
              {card.kind === 'word' && (
                <button onClick={() => drop(card)} title={t('review.removeTip')}>
                  {t('review.remove')}
                </button>
              )}
              <span style={{ flex: 1 }} />
              <button onClick={() => rate(card, false)}>{t('review.again')}</button>
              <button className="primary" onClick={() => rate(card, true)} autoFocus>
                {t('review.good')}
              </button>
            </>
          )}
          {!(card && shown) && !card && (
            <button className="primary" onClick={onClose} autoFocus>
              {t('common.close')}
            </button>
          )}
          {card && !shown && <button onClick={onClose}>{t('common.close')}</button>}
        </div>
      </Dialog>
    </div>
  )
}
