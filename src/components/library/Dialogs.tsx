import { useEffect, useState } from 'react'
import { Dialog } from '../Dialog'
import { t } from '../../i18n'
import { Dropdown } from '../Dropdown'
import type { BookMeta } from '../../lib/db'
import { formatBookName, type BookName } from '../../lib/bookName'
import { folderKey, type Folder } from '../../lib/folders'
import type { DupAsk, DupBatch } from '../../hooks/useImport'
import type { PwAsk } from '../../hooks/useBackup'
import type { ConfirmAsk } from '../../hooks/useConfirm'
import type { FolderDialogState } from '../../hooks/useFolders'
import { FolderIcon } from './FolderIcon'
import { Stars } from '../Stars'
import type { BookFormat } from '../../lib/bookExport'
import { loadCustomFont } from '../../lib/customFont'
import {
  loadPdfOptions,
  PDF_FONT_LABELS,
  PDF_INDENTS,
  PDF_SIZES,
  PDF_SPACINGS,
  savePdfOptions,
  type PdfFontKey,
  type PdfOptions,
} from '../../lib/pdfOptions'

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
            {ask.cancel ?? t('common.cancel')}
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
  onMove: (name: string | undefined, created?: boolean, setAuthor?: boolean) => void
  onCancel: () => void
}) {
  // off by default: a folder like "summer reading" must not overwrite the books' authors
  const [setAuthor, setSetAuthor] = useState(false)
  // the author only changes for a named folder, never for "no author" or "back to the author"
  const move = (name: string, created?: boolean) => onMove(name, created, !!name && setAuthor)
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
                <button onClick={() => move(f.name)}>
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
            onKeyDown={(e) => e.key === 'Enter' && newFolder.trim() && move(newFolder.trim(), true)}
            placeholder={t('folder.name')}
          />
        </label>
        <label className="check-row">
          <input type="checkbox" checked={setAuthor} onChange={(e) => setSetAuthor(e.target.checked)} />
          {t('move.setAuthor', { n: books.length })}
        </label>
        <div className="modal-actions">
          <button className="primary" disabled={!newFolder.trim()} onClick={() => move(newFolder.trim(), true)}>
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
  dialog: FolderDialogState
  onChange: (d: FolderDialogState) => void
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
        {dialog.rename !== undefined && (
          <label className="check-row">
            <input type="checkbox" checked={!!dialog.author} onChange={(e) => onChange({ ...dialog, author: e.target.checked })} />
            {t('folder.renameAuthor')}
          </label>
        )}
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
  words,
  rating,
  onRate,
  knownTags,
  phoneFile,
  identify,
  error,
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
  /** words in the book, shown read-only; undefined while still being counted, null for a book with no text (audio) */
  words: number | null | undefined
  /** 1–5, 0 = not rated; a tap saves it at once (not with the dialog's save) */
  rating: number
  onRate: (r: number) => void
  /** tags already used elsewhere, offered as suggestions */
  knownTags: string[]
  /** the book's file on the phone, when it has one: whether it is renamed along with the book */
  phoneFile?: { sync: boolean; onSync: (v: boolean) => void }
  /** looks the book up and fills the fields with what was found; `note` says where it came from */
  identify: { busy: boolean; note?: string; run: () => void }
  /** why the last save failed; shown in the dialog, which stays open so it can be tried again */
  error?: string
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
        {words !== null && (
          <label>
            {t('edit.words')}
            <input
              readOnly
              tabIndex={-1}
              className="readonly-field"
              value={words === undefined ? t('edit.wordsCounting') : words > 0 ? words.toLocaleString() : '—'}
            />
          </label>
        )}
        <div className="rating-row">
          <span>{t('rating.label')}</span>
          <Stars value={rating} onRate={onRate} />
        </div>
        {phoneFile && (
          <label className="check-row">
            <input type="checkbox" checked={phoneFile.sync} onChange={(e) => phoneFile.onSync(e.target.checked)} />
            {t('edit.syncPhone')}
          </label>
        )}
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
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

/** the stored file's own format, as its extension says (MOBI, AZW3, FB2, CBZ) */
const formatName = (b: BookMeta) => (b.fileName.match(/\.([^.]+)$/)?.[1] ?? '').toUpperCase()

/** "Download to phone": which format the book is saved in. Its own format comes first and is marked as the original. */
export function FormatDialog({
  book,
  formats,
  onPick,
  onCancel,
}: {
  book: BookMeta
  formats: BookFormat[]
  onPick: (f: BookFormat, pdf?: PdfOptions) => void
  onCancel: () => void
}) {
  // the PDF is laid out by the reader's own choices, asked after the format is picked
  const [pdfStep, setPdfStep] = useState(false)
  const [opts, setOpts] = useState<PdfOptions>(loadPdfOptions)
  const [customName, setCustomName] = useState<string>()
  useEffect(() => {
    void loadCustomFont().then((f) => setCustomName(f?.name))
  }, [])
  const set = <K extends keyof PdfOptions>(k: K, v: PdfOptions[K]) => setOpts((o) => ({ ...o, [k]: v }))
  const fontOptions: { value: PdfFontKey; label: string }[] = [
    ...(Object.keys(PDF_FONT_LABELS) as Exclude<PdfFontKey, 'custom'>[]).map((k) => ({ value: k, label: PDF_FONT_LABELS[k] })),
    ...(customName ? [{ value: 'custom' as PdfFontKey, label: t('pdf.fontCustom', { name: customName }) }] : []),
  ]
  const numOptions = (list: number[], keys: Parameters<typeof t>[0][]) => list.map((v, i) => ({ value: String(v), label: t(keys[i]!) }))
  const go = () => {
    const chosen = opts.font === 'custom' && !customName ? { ...opts, font: 'heebo' as const } : opts
    savePdfOptions(chosen)
    onPick('pdf', chosen)
  }
  if (pdfStep)
    return (
      <div className="modal-backdrop" onClick={onCancel}>
        <Dialog
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-label={t('pdf.title')}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.key === 'Escape' && onCancel()}
        >
          <h2>{t('pdf.title')}</h2>
          <div className="pdf-options">
            <label>
              <span>{t('pdf.font')}</span>
              <Dropdown label={t('pdf.font')} value={opts.font} options={fontOptions} onChange={(v) => set('font', v)} />
            </label>
            <label>
              <span>{t('pdf.size')}</span>
              <Dropdown
                label={t('pdf.size')}
                value={String(opts.size)}
                options={numOptions(PDF_SIZES, ['pdf.sizeSmall', 'pdf.sizeNormal', 'pdf.sizeLarge', 'pdf.sizeXLarge'])}
                onChange={(v) => set('size', Number(v))}
              />
            </label>
            <label>
              <span>{t('pdf.indent')}</span>
              <Dropdown
                label={t('pdf.indent')}
                value={String(opts.indent)}
                options={numOptions(PDF_INDENTS, ['pdf.indentNone', 'pdf.indentSmall', 'pdf.indentMedium', 'pdf.indentLarge'])}
                onChange={(v) => set('indent', Number(v))}
              />
            </label>
            <label>
              <span>{t('pdf.spacing')}</span>
              <Dropdown
                label={t('pdf.spacing')}
                value={String(opts.spacing)}
                options={numOptions(PDF_SPACINGS, ['pdf.spacingTight', 'pdf.spacingNormal', 'pdf.spacingLoose', 'pdf.spacingWide'])}
                onChange={(v) => set('spacing', Number(v))}
              />
            </label>
          </div>
          <div className="modal-actions">
            <button onClick={() => setPdfStep(false)}>{t('pdf.back')}</button>
            <button className="primary" onClick={go} autoFocus>
              {t('pdf.go')}
            </button>
          </div>
        </Dialog>
      </div>
    )
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <Dialog
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('book.saveToPhone')}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      >
        <h2>{t('book.saveToPhone')}</h2>
        <p>{t('book.formatText', { title: book.title })}</p>
        <div className="format-list" role="group" aria-label={t('book.saveToPhone')}>
          {formats.map((f, i) => (
            <button key={f} className={'format-option' + (i === 0 ? ' primary' : '')} onClick={() => (f === 'pdf' ? setPdfStep(true) : onPick(f))} autoFocus={i === 0}>
              <span className="format-name">
                {f === 'original' ? formatName(book) : t(`format.${f}`)}
                {i === 0 && <span className="format-badge">{t('book.formatOriginal')}</span>}
              </span>
              <span className="format-hint">{t(f === 'original' ? 'format.originalHint' : `format.${f}Hint`)}</span>
            </button>
          ))}
        </div>
        <div className="modal-actions">
          <button onClick={onCancel}>{t('common.cancel')}</button>
        </div>
      </Dialog>
    </div>
  )
}
