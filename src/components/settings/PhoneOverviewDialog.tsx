import { useState } from 'react'
import { Dialog } from '../Dialog'
import { t } from '../../i18n'
import { formatBytes } from '../../lib/storage'
import type { PhoneOverview } from '../../lib/phoneOverview'

/** What the scanned folders hold (lib/phoneOverview), with the two things that can be done about it from here: file the converted
 *  copies still waiting in Download, and clean up the books that are there more than once (the cleanup's own dialog opens). */
export function PhoneOverviewDialog({
  overview: o,
  pending,
  onFile,
  onClean,
  onClose,
}: {
  overview: PhoneOverview
  /** converted copies saved to Download that have not been filed under their author's versions folder yet */
  pending: number
  onFile: () => Promise<number>
  onClean: () => void
  onClose: () => void
}) {
  const [waiting, setWaiting] = useState(pending)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  const file = async () => {
    setBusy(true)
    try {
      const moved = await onFile()
      setWaiting((n) => Math.max(0, n - moved))
      setNote(t('overview.filed', { n: moved }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <Dialog
        className="modal copies"
        role="dialog"
        aria-modal="true"
        aria-label={t('overview.title')}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <h2>{t('overview.title')}</h2>
        {!o.files && !waiting ? (
          <p>{t('overview.none')}</p>
        ) : (
          <>
            <p>
              <strong>{t('overview.files', { n: o.files, size: formatBytes(o.bytes) })}</strong>
            </p>
            <ul>
              {o.byFormat.map((f) => (
                <li key={f.ext}>
                  {(f.ext || '?').toUpperCase()}: {f.count} · {formatBytes(f.bytes)}
                </li>
              ))}
            </ul>
            <ul>
              <li>{t('overview.inBooks', { n: o.inBooksFolder })}</li>
              <li>{t('overview.versions', { n: o.versions })}</li>
              <li>{t('overview.outside', { n: o.outside })}</li>
              <li>{t('overview.tracked', { n: o.tracked })}</li>
              <li>{t('overview.untracked', { n: o.untracked })}</li>
              {o.missing > 0 && <li>{t('overview.missing', { n: o.missing })}</li>}
              {waiting > 0 && <li>{t('overview.pending', { n: waiting })}</li>}
              <li>{o.duplicateGroups ? t('overview.dupes', { n: o.duplicateGroups, surplus: o.surplusFiles, size: formatBytes(o.surplusBytes) }) : t('overview.noDupes')}</li>
            </ul>
          </>
        )}
        {note && <div role="status" className="muted">{note}</div>}
        <div className="row">
          {waiting > 0 && (
            <button disabled={busy} onClick={() => void file()}>
              {t('overview.file')}
            </button>
          )}
          {o.duplicateGroups > 0 && (
            <button disabled={busy} onClick={onClean}>
              {t('overview.clean')}
            </button>
          )}
          <button disabled={busy} onClick={onClose}>
            {t('copies.close')}
          </button>
        </div>
      </Dialog>
    </div>
  )
}
