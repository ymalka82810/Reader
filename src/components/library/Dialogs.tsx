import { Dialog } from '../Dialog'
import { t } from '../../i18n'
import { Dropdown } from '../Dropdown'
import type { BookMeta } from '../../lib/db'
import { formatBookName, type BookName } from '../../lib/bookName'
import { folderKey, type Folder } from '../../lib/folders'
import type { DupAsk, DupBatch } from '../../hooks/useImport'
import type { PwAsk } from '../../hooks/useBackup'
import type { ConfirmAsk } from '../../hooks/useConfirm'
import { FolderIcon } from './FolderIcon'

export function DuplicateBatchDialog({
  batch,
  detail,
  onDetail,
  onChange,
}: {
  batch: DupBatch
  detail: boolean
  onDetail: () => void
  onChange: (b: DupBatch) => void
}) {
  return (
    <div className="modal-backdrop">
      <Dialog className="modal" role="alertdialog" aria-modal="true" aria-label={t('dup.batchLabel')}>
        <h2>{t('dup.batchTitle', { n: batch.items.length })}</h2>
        <p>{t('dup.batchText')}</p>
        {detail && (
          <ul className="dup-list">
            {batch.items.map((it, i) => (
              <li key={i}>
                <span>
                  {t('dup.item', { title: it.existing.title, name: it.name })}
                </span>
                <Dropdown
                  label={t('dup.actionFor', { title: it.existing.title })}
                  value={it.choice}
                  onChange={(choice) =>
                    onChange({ ...batch, items: batch.items.map((x, j) => (j === i ? { ...x, choice } : x)) })
                  }
                  options={[
                    { value: 'skip', label: t('dup.skip') },
                    { value: 'add', label: t('dup.addAnyway') },
                    { value: 'replace', label: t('dup.replace') },
                  ]}
                />
              </li>
            ))}
          </ul>
        )}
        <div className="modal-actions">
          {detail ? (
            <button className="primary" onClick={() => batch.done(batch.items.map((x) => x.choice))}>
              {t('common.ok')}
            </button>
          ) : (
            <>
              <button className="danger" onClick={() => batch.done(batch.items.map(() => 'replace'))}>
                {t('dup.replaceAll')}
              </button>
              <button onClick={() => batch.done(batch.items.map(() => 'add'))}>{t('dup.addAll')}</button>
              <button onClick={() => batch.done(batch.items.map(() => 'skip'))} autoFocus>
                {t('dup.skipAll')}
              </button>
              <button onClick={onDetail}>{t('dup.details')}</button>
            </>
          )}
        </div>
      </Dialog>
    </div>
  )
}

export function DuplicateAskDialog({ ask, onDone }: { ask: DupAsk; onDone: () => void }) {
  const answer = (c: 'replace' | 'add' | 'skip') => {
    ask.answer(c)
    onDone()
  }
  return (
    <div className="modal-backdrop">
      <Dialog className="modal" role="alertdialog" aria-modal="true" aria-label={t('dup.askLabel')}>
        <h2>{t('dup.askTitle')}</h2>
        <p>{t('dup.askText', { title: ask.existing.title, file: ask.file })}</p>
        <div className="modal-actions">
          <button className="danger" onClick={() => answer('replace')}>
            {t('dup.replace')}
          </button>
          <button onClick={() => answer('add')}>{t('dup.addAnyway')}</button>
          <button onClick={() => answer('skip')} autoFocus>
            {t('dup.skip')}
          </button>
        </div>
      </Dialog>
    </div>
  )
}

export function ConfirmDeleteDialog({
  books,
  onConfirm,
  onCancel,
}: {
  books: BookMeta[]
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <Dialog
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-label={t('del.label')}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      >
        <h2>{t('del.title', { n: books.length })}</h2>
        <p>
          {books.length === 1 ? t('del.textOne', { title: books[0]?.title ?? '' }) : t('del.textMany')} {t('del.undoHint')}
        </p>
        <div className="modal-actions">
          <button className="danger" onClick={onConfirm}>{t('common.delete')}</button>
          <button onClick={onCancel} autoFocus>{t('common.cancel')}</button>
        </div>
      </Dialog>
    </div>
  )
}

export function ConfirmDialog({ ask }: { ask: ConfirmAsk & { answer: (yes: boolean) => void } }) {
  const cancel = () => ask.answer(false)
  return (
    <div className="modal-backdrop" onClick={cancel}>
      <Dialog
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-label={ask.title}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && cancel()}
      >
        <h2>{ask.title}</h2>
        {ask.text && <p>{ask.text}</p>}
        <div className="modal-actions">
          <button className={ask.danger ? 'danger' : 'primary'} onClick={() => ask.answer(true)} autoFocus={!ask.danger}>
            {ask.ok}
          </button>
          <button onClick={cancel} autoFocus={ask.danger}>
            {t('common.cancel')}
          </button>
        </div>
      </Dialog>
    </div>
  )
}

export function MoveDialog({
  books,
  folders,
  newFolder,
  onNewFolder,
  onMove,
  onCancel,
}: {
  books: BookMeta[]
  folders: Folder[]
  newFolder: string
  onNewFolder: (name: string) => void
  onMove: (name: string | undefined, created?: boolean) => void
  onCancel: () => void
}) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <Dialog
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('move.label')}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      >
        <h2>{t('move.title', { n: books.length, title: books[0]?.title ?? '' })}</h2>
        <ul className="move-list">
          {folders
            .filter((f) => !books.every((b) => folderKey(b) === f.key))
            .map((f) => (
              <li key={f.key}>
                <button onClick={() => onMove(f.name)}>
                  <FolderIcon /> {f.name || t('folder.noAuthor')} <small>({t('books.count', { n: f.books.length })})</small>
                </button>
              </li>
            ))}
          {!folders.some((f) => !f.key) && (
            <li>
              <button onClick={() => onMove('')}><FolderIcon /> {t('folder.noAuthor')}</button>
            </li>
          )}
          {books.some((b) => b.folder !== undefined) && (
            <li>
              <button onClick={() => onMove(undefined)}>↺ {t('move.backToAuthor')}</button>
            </li>
          )}
        </ul>
        <label>
          {t('folder.new')}
          <input
            value={newFolder}
            onChange={(e) => onNewFolder(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && newFolder.trim() && onMove(newFolder.trim(), true)}
            placeholder={t('folder.name')}
          />
        </label>
        <div className="modal-actions">
          <button className="primary" disabled={!newFolder.trim()} onClick={() => onMove(newFolder.trim(), true)}>
            {t('move.createAndMove')}
          </button>
          <button onClick={onCancel}>{t('common.cancel')}</button>
        </div>
      </Dialog>
    </div>
  )
}

export function FolderNameDialog({
  dialog,
  onChange,
  onSave,
  onCancel,
}: {
  dialog: { rename?: string; name: string }
  onChange: (d: { rename?: string; name: string }) => void
  onSave: () => void
  onCancel: () => void
}) {
  const title = dialog.rename !== undefined ? t('folder.rename') : t('folder.new')
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <Dialog
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
          else if (e.key === 'Enter') onSave()
        }}
      >
        <h2>{title}</h2>
        <label>
          {t('folder.name')}
          <input value={dialog.name} onChange={(e) => onChange({ ...dialog, name: e.target.value })} autoFocus />
        </label>
        <div className="modal-actions">
          <button className="primary" disabled={!dialog.name.trim()} onClick={onSave}>
            {t('common.save')}
          </button>
          <button onClick={onCancel}>{t('common.cancel')}</button>
        </div>
      </Dialog>
    </div>
  )
}

export function PasswordDialog({
  ask,
  pw,
  onPw,
  onSubmit,
  onCancel,
}: {
  ask: PwAsk
  pw: string
  onPw: (pw: string) => void
  onSubmit: () => void
  onCancel: () => void
}) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <Dialog
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={ask.kind === 'export' ? t('backup.title') : t('backup.encryptedLabel')}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
          else if (e.key === 'Enter' && (ask.kind === 'export' || pw)) onSubmit()
        }}
      >
        <h2>{ask.kind === 'export' ? t('backup.title') : t('backup.encryptedTitle')}</h2>
        <label>
          {ask.kind === 'export' ? t('backup.passwordOptional') : t('backup.password')}
          <input type="password" value={pw} onChange={(e) => onPw(e.target.value)} autoFocus autoComplete="off" />
        </label>
        {ask.kind === 'export' && <small>{t('backup.passwordHint')}</small>}
        {ask.kind === 'import' && ask.wrong && <small role="alert">{t('backup.wrongPassword')}</small>}
        <div className="modal-actions">
          <button className="primary" onClick={onSubmit} disabled={ask.kind === 'import' && !pw}>
            {ask.kind === 'export' ? t('backup.create') : t('backup.restoreBtn')}
          </button>
          <button onClick={onCancel}>{t('common.cancel')}</button>
        </div>
      </Dialog>
    </div>
  )
}

export function EditBookDialog({
  name,
  author,
  tags,
  knownTags,
  phoneFile,
  identify,
  onName,
  onAuthor,
  onTags,
  onSave,
  onCancel,
}: {
  /** the title in the naming template's parts; saved as formatBookName(name) */
  name: BookName
  author: string
  /** the tags field as typed */
  tags: string
  /** tags already used elsewhere, offered as suggestions */
  knownTags: string[]
  /** the book's file on the phone, when it has one: whether it is renamed along with the book */
  phoneFile?: { sync: boolean; onSync: (v: boolean) => void }
  /** looks the book up and fills the fields with what was found; `note` says where it came from */
  identify: { busy: boolean; note?: string; run: () => void }
  onName: (v: BookName) => void
  onAuthor: (v: string) => void
  onTags: (v: string) => void
  onSave: () => void
  onCancel: () => void
}) {
  const full = formatBookName(name)
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <Dialog
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('edit.title')}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
          else if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT' && full) onSave()
        }}
      >
        <h2>{t('edit.title')}</h2>
        <div className="series-row">
          <label>
            {t('edit.series')}
            <input value={name.series} onChange={(e) => onName({ ...name, series: e.target.value })} placeholder={t('edit.seriesHint')} />
          </label>
          <label className="series-no">
            {t('edit.seriesNo')}
            <input value={name.number} onChange={(e) => onName({ ...name, number: e.target.value })} inputMode="numeric" />
          </label>
        </div>
        <label>
          {t('edit.bookName')}
          <input value={name.title} onChange={(e) => onName({ ...name, title: e.target.value })} autoFocus />
        </label>
        <label>
          {t('edit.author')}
          <input value={author} onChange={(e) => onAuthor(e.target.value)} />
        </label>
        {full && <small className="muted saved-as">{t('edit.savedAs', { name: full })}</small>}
        <button className="secondary" onClick={identify.run} disabled={identify.busy || !full}>
          {identify.busy ? t('edit.identifying') : t('edit.identify')}
        </button>
        {identify.note && <small role="status">{identify.note}</small>}
        <label>
          {t('edit.tags')}
          <input value={tags} onChange={(e) => onTags(e.target.value)} placeholder={t('edit.tagsHint')} list="known-tags" />
          <datalist id="known-tags">
            {knownTags.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </label>
        {phoneFile && (
          <label className="check-row">
            <input type="checkbox" checked={phoneFile.sync} onChange={(e) => phoneFile.onSync(e.target.checked)} />
            {t('edit.syncPhone')}
          </label>
        )}
        <div className="modal-actions">
          <button className="primary" onClick={onSave} disabled={!full}>
            {t('common.save')}
          </button>
          <button onClick={onCancel}>{t('common.cancel')}</button>
        </div>
      </Dialog>
    </div>
  )
}
