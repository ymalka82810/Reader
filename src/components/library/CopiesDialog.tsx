import { useEffect, useState } from 'react'
import { Dialog } from '../Dialog'
import { t } from '../../i18n'
import type { BookMeta } from '../../lib/db'
import { keeperOf, markNotCopies, mergeCopies } from '../../lib/bookCopies'
import type { Confirm } from '../../hooks/useConfirm'

const kindOf = (b: BookMeta) => (b.kind === 'pdf' ? 'PDF' : b.fromPdf ? 'EPUB (PDF)' : 'EPUB')
const percent = (b: BookMeta) => Math.round((b.fraction ?? 0) * 100)

/** The books the library has more than once (lib/bookCopies), each group shown with the copy that stays and the ones
 *  that go, merged or set apart one group at a time, or all merged at once after a confirmation. */
export function CopiesDialog({
  groups,
  confirm,
  onChanged,
  onClose,
}: {
  groups: BookMeta[][]
  confirm: Confirm
  /** after a merge or a "not the same": the library reads its books again */
  onChanged: () => Promise<void> | void
  onClose: () => void
}) {
  const [keepers, setKeepers] = useState<Map<BookMeta[], string>>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    void Promise.all(groups.map(async (g) => [g, (await keeperOf(g)).id] as const)).then((k) => live && setKeepers(new Map(k)))
    return () => {
      live = false
    }
  }, [groups])

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await work()
      await onChanged()
    } finally {
      setBusy(false)
    }
  }

  const mergeAll = async () => {
    const yes = await confirm({ title: t('copies.title', { n: groups.length }), text: t('copies.allText'), ok: t('copies.mergeAll'), danger: true })
    if (yes) await act(() => mergeCopies(groups))
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <Dialog
        className="modal copies"
        role="dialog"
        aria-modal="true"
        aria-label={t('copies.review')}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <h2>{t('copies.review')}</h2>
        {!groups.length && <p>{t('copies.none')}</p>}
        <ul className="copies-list">
          {groups.map((g) => (
            <li key={g.map((b) => b.id).join('|')}>
              <ul>
                {g.map((b) => {
                  const stays = keepers?.get(g) === b.id
                  return (
                    <li key={b.id}>
                      <strong>{stays ? t('copies.stays') : t('copies.goes')}</strong> {b.title}
                      {b.author && ` · ${b.author}`} · {kindOf(b)}
                      {percent(b) > 0 && ` · ${t('copies.read', { n: percent(b) })}`}
                    </li>
                  )
                })}
              </ul>
              <div className="row">
                <button disabled={busy || !keepers} className="danger" onClick={() => void act(() => mergeCopies([g]))}>
                  {t('copies.merge')}
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      markNotCopies([g])
                    })
                  }
                >
                  {t('copies.notSame')}
                </button>
              </div>
            </li>
          ))}
        </ul>
        <div className="row">
          {groups.length > 1 && (
            <button disabled={busy || !keepers} className="danger" onClick={() => void mergeAll()}>
              {t('copies.mergeAll')}
            </button>
          )}
          <button onClick={onClose}>{t('copies.close')}</button>
        </div>
      </Dialog>
    </div>
  )
}
