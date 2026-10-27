import { t } from '../../i18n'
import type { SeriesPlace } from '../../lib/nextInSeries'
import { Panel } from './shared'

export interface Recap {
  /** days since the book was last opened */
  days: number
  chapter: string
  /** the text just before where the reader stopped */
  text: string
  /** the reader's most recent highlight in this book, '' when there is none */
  highlight: string
}

/** "where was I?": shown when a book is opened again after a few days away */
export function RecapPanel({ recap, onClose }: { recap: Recap; onClose: () => void }) {
  return (
    <Panel label={t('recap.title')} className="recap">
      <h3>{t('recap.title')}</h3>
      <p className="muted">{[t('recap.away', { n: recap.days }), recap.chapter].filter(Boolean).join(' · ')}</p>
      {recap.text && (
        <>
          <h4>{t('recap.lastRead')}</h4>
          <blockquote>{recap.text}</blockquote>
        </>
      )}
      {recap.highlight && (
        <>
          <h4>{t('recap.lastHighlight')}</h4>
          <blockquote className="hl">{recap.highlight}</blockquote>
        </>
      )}
      <button className="primary" onClick={onClose}>
        {t('recap.continue')}
      </button>
    </Panel>
  )
}

/** the end of the book: the read mark, the next book of the series, back to the library */
export function EndPanel({
  title,
  finished,
  place,
  onFinished,
  onOpen,
  onLibrary,
  onClose,
}: {
  title: string
  finished: boolean
  place?: SeriesPlace
  onFinished: (v: boolean) => void
  onOpen?: (id: string) => void
  onLibrary: () => void
  onClose: () => void
}) {
  const next = place?.next
  return (
    <Panel label={t('end.title')} className="end-of-book">
      <h3>{t('end.title')}</h3>
      <p className="end-name">{title}</p>
      <label className="row">
        <input type="checkbox" checked={finished} onChange={(e) => onFinished(e.target.checked)} />
        {t('end.markRead')}
      </label>
      {place && next && onOpen && (
        <div className="end-next">
          <p>{place.nextNumber === place.number + 1 ? t('end.next') : t('end.nextGap', { missing: String(place.number + 1) })}</p>
          <button className="primary" onClick={() => onOpen(next.id)}>
            {next.title}
          </button>
        </div>
      )}
      {place && !next && <p className="muted">{t('end.noNext', { series: place.series, n: String(place.number + 1) })}</p>}
      <div className="row end-actions">
        <button onClick={onLibrary}>{t('reader.backToLibrary')}</button>
        <button onClick={onClose}>{t('common.close')}</button>
      </div>
    </Panel>
  )
}
