import { useState } from 'react'
import { Dialog } from '../Dialog'
import { t } from '../../i18n'
import type { DuplicateGroup } from '../../lib/phoneDuplicates'
import { tidyPhoneDuplicates } from '../../lib/phoneFiles'

/** the file's folder, as a short hint next to its name */
const where = (path: string) => path.split('/').slice(-2, -1)[0] ?? ''

/** The books found on the phone more than once (lib/phoneDuplicates): per book, the file that stays, the formats filed
 *  under the author's versions folder, and the surplus copies, each with a box to approve deleting it. Nothing is deleted
 *  before the button is pressed, and only the boxes left ticked. */
export function PhoneDuplicatesDialog({ groups, onDone, onClose }: { groups: DuplicateGroup[]; onDone: (msg: string) => void; onClose: () => void }) {
  const [approved, setApproved] = useState(() => new Set(groups.flatMap((g) => g.surplus.map((f) => f.path))))
  const [busy, setBusy] = useState(false)
  const moved = groups.reduce((n, g) => n + g.versions.length, 0)

  const toggle = (path: string) =>
    setApproved((a) => {
      const next = new Set(a)
      if (!next.delete(path)) next.add(path)
      return next
    })

  const apply = async () => {
    setBusy(true)
    try {
      const r = await tidyPhoneDuplicates(groups, approved)
      onDone(t('dupes.done', r))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <Dialog
        className="modal copies"
        role="dialog"
        aria-modal="true"
        aria-label={t('dupes.title')}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && !busy && onClose()}
      >
        <h2>{t('dupes.title')}</h2>
        <p className="muted">{t('dupes.warn')}</p>
        <ul className="copies-list">
          {groups.map((g) => (
            <li key={g.keep.path}>
              <strong>{g.title}</strong>
              {g.by === 'content' && <small className="muted"> · {t('dupes.byContent')}</small>}
              <ul>
                <li>
                  {t('dupes.keep')} {g.keep.name} · {where(g.keep.path)}
                </li>
                {g.versions.map((v) => (
                  <li key={v.path}>
                    {t('dupes.version')} {v.name} · {where(v.path)}
                  </li>
                ))}
                {g.surplus.map((f) => (
                  <li key={f.path}>
                    <label>
                      <input type="checkbox" checked={approved.has(f.path)} disabled={busy} onChange={() => toggle(f.path)} /> {t('dupes.delete')} {f.name} · {where(f.path)}
                    </label>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        <div className="row">
          <button disabled={busy || (!approved.size && !moved)} className={approved.size ? 'danger' : undefined} onClick={() => void apply()}>
            {t('dupes.apply', { deleted: approved.size, moved })}
          </button>
          <button disabled={busy} onClick={onClose}>
            {t('copies.close')}
          </button>
        </div>
      </Dialog>
    </div>
  )
}
