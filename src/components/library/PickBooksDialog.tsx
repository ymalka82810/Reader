import { useState } from 'react'
import { Dialog } from '../Dialog'
import type { BookMeta } from '../../lib/db'
import { t } from '../../i18n'

/** choose individual books to show; nothing ticked means no pick */
export function PickBooksDialog({
  books,
  picked,
  onDone,
  onCancel,
}: {
  books: BookMeta[]
  picked: ReadonlySet<string>
  onDone: (ids: Set<string>) => void
  onCancel: () => void
}) {
  const [ids, setIds] = useState(() => new Set(picked))
  const toggle = (id: string) =>
    setIds((s) => {
      const n = new Set(s)
      if (!n.delete(id)) n.add(id)
      return n
    })

  return (
    <div className="modal-backdrop">
      <Dialog className="modal" role="dialog" aria-modal="true" aria-label={t('pick.title')}>
        <h2>{t('pick.title')}</h2>
        <ul className="dup-list">
          {books.map((b) => (
            <li key={b.id}>
              <label className="pick-row">
                <input type="checkbox" checked={ids.has(b.id)} onChange={() => toggle(b.id)} />
                <span>{b.title}</span>
              </label>
            </li>
          ))}
        </ul>
        <div className="modal-actions">
          <button onClick={() => setIds(new Set())} disabled={!ids.size}>
            {t('pick.clear')}
          </button>
          <button onClick={onCancel}>{t('pick.cancel')}</button>
          <button className="primary" onClick={() => onDone(ids)}>
            {ids.size ? t('pick.show', { n: ids.size }) : t('pick.ok')}
          </button>
        </div>
      </Dialog>
    </div>
  )
}
