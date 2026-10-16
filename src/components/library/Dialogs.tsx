import { Dialog } from '../Dialog'
import { Dropdown } from '../Dropdown'
import type { BookMeta } from '../../lib/db'
import { folderKey, type Folder } from '../../lib/folders'
import type { DupAsk, DupBatch } from '../../hooks/useImport'
import type { PwAsk } from '../../hooks/useBackup'

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
      <Dialog className="modal" role="alertdialog" aria-modal="true" aria-label="ספרים כפולים">
        <h2>{batch.items.length} ספרים כבר קיימים בספרייה</h2>
        <p>שאר הספרים נוספו. מה לעשות עם הכפולים? החלפה מוחקת את הגרסה הקיימת יחד עם מיקום הקריאה וההערות שלה.</p>
        {detail && (
          <ul className="dup-list">
            {batch.items.map((it, i) => (
              <li key={i}>
                <span>
                  ״{it.existing.title}״ ← {it.name}
                </span>
                <Dropdown
                  label={`פעולה עבור ${it.existing.title}`}
                  value={it.choice}
                  onChange={(choice) =>
                    onChange({ ...batch, items: batch.items.map((x, j) => (j === i ? { ...x, choice } : x)) })
                  }
                  options={[
                    { value: 'skip', label: 'דלג' },
                    { value: 'add', label: 'הוסף בכל זאת' },
                    { value: 'replace', label: 'החלף' },
                  ]}
                />
              </li>
            ))}
          </ul>
        )}
        <div className="modal-actions">
          {detail ? (
            <button className="primary" onClick={() => batch.done(batch.items.map((x) => x.choice))}>
              אישור
            </button>
          ) : (
            <>
              <button className="danger" onClick={() => batch.done(batch.items.map(() => 'replace'))}>
                החלף הכל
              </button>
              <button onClick={() => batch.done(batch.items.map(() => 'add'))}>הוסף הכל</button>
              <button onClick={() => batch.done(batch.items.map(() => 'skip'))} autoFocus>
                דלג על הכל
              </button>
              <button onClick={onDetail}>פירוט</button>
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
      <Dialog className="modal" role="alertdialog" aria-modal="true" aria-label="הספר כבר קיים">
        <h2>הספר כבר קיים בספרייה</h2>
        <p>
          ״{ask.existing.title}״ כבר בספרייה. להחליף אותו בקובץ {ask.file}? החלפה תמחק את הגרסה הקיימת יחד עם מיקום
          הקריאה וההערות שלה.
        </p>
        <div className="modal-actions">
          <button className="danger" onClick={() => answer('replace')}>
            החלף
          </button>
          <button onClick={() => answer('add')}>הוסף בכל זאת</button>
          <button onClick={() => answer('skip')} autoFocus>
            דלג
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
        aria-label="אישור מחיקה"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      >
        <h2>למחוק {books.length === 1 ? 'את הספר' : `${books.length} ספרים`}?</h2>
        <p>
          {books.length === 1
            ? `״${books[0]?.title}״ יימחק יחד עם מיקום הקריאה וההערות שלו.`
            : 'הספרים שנבחרו יימחקו יחד עם מיקום הקריאה וההערות שלהם.'}{' '}
          אפשר יהיה לבטל תוך כמה שניות.
        </p>
        <div className="modal-actions">
          <button className="danger" onClick={onConfirm}>מחק</button>
          <button onClick={onCancel} autoFocus>ביטול</button>
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
        aria-label="העברה לתיקייה"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      >
        <h2>
          להעביר {books.length === 1 ? `את ״${books[0]?.title}״` : `${books.length} ספרים`} ל…
        </h2>
        <ul className="move-list">
          {folders
            .filter((f) => !books.every((b) => folderKey(b) === f.key))
            .map((f) => (
              <li key={f.key}>
                <button onClick={() => onMove(f.name)}>
                  📁 {f.name || 'ללא מחבר'} <small>({f.books.length} ספרים)</small>
                </button>
              </li>
            ))}
          {!folders.some((f) => !f.key) && (
            <li>
              <button onClick={() => onMove('')}>📁 ללא מחבר</button>
            </li>
          )}
          {books.some((b) => b.folder !== undefined) && (
            <li>
              <button onClick={() => onMove(undefined)}>↺ חזרה לתיקיית המחבר</button>
            </li>
          )}
        </ul>
        <label>
          תיקייה חדשה
          <input
            value={newFolder}
            onChange={(e) => onNewFolder(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && newFolder.trim() && onMove(newFolder.trim(), true)}
            placeholder="שם התיקייה"
          />
        </label>
        <div className="modal-actions">
          <button className="primary" disabled={!newFolder.trim()} onClick={() => onMove(newFolder.trim(), true)}>
            צור והעבר
          </button>
          <button onClick={onCancel}>ביטול</button>
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
  const title = dialog.rename !== undefined ? 'שינוי שם תיקייה' : 'תיקייה חדשה'
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
          שם התיקייה
          <input value={dialog.name} onChange={(e) => onChange({ ...dialog, name: e.target.value })} autoFocus />
        </label>
        <div className="modal-actions">
          <button className="primary" disabled={!dialog.name.trim()} onClick={onSave}>
            שמירה
          </button>
          <button onClick={onCancel}>ביטול</button>
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
        aria-label={ask.kind === 'export' ? 'גיבוי' : 'גיבוי מוצפן'}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
          else if (e.key === 'Enter' && (ask.kind === 'export' || pw)) onSubmit()
        }}
      >
        <h2>{ask.kind === 'export' ? 'גיבוי' : 'הגיבוי מוצפן'}</h2>
        <label>
          {ask.kind === 'export' ? 'סיסמה להצפנה (אופציונלי)' : 'סיסמה'}
          <input type="password" value={pw} onChange={(e) => onPw(e.target.value)} autoFocus autoComplete="off" />
        </label>
        {ask.kind === 'export' && (
          <small>השאירו ריק לגיבוי רגיל. עם סיסמה אין דרך לשחזר את הגיבוי אם היא אבדה.</small>
        )}
        {ask.kind === 'import' && ask.wrong && <small role="alert">הסיסמה שגויה, נסו שוב.</small>}
        <div className="modal-actions">
          <button className="primary" onClick={onSubmit} disabled={ask.kind === 'import' && !pw}>
            {ask.kind === 'export' ? 'צור גיבוי' : 'שחזר'}
          </button>
          <button onClick={onCancel}>ביטול</button>
        </div>
      </Dialog>
    </div>
  )
}

export function EditBookDialog({
  title,
  author,
  onTitle,
  onAuthor,
  onSave,
  onCancel,
}: {
  title: string
  author: string
  onTitle: (v: string) => void
  onAuthor: (v: string) => void
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <Dialog
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="עריכת פרטי ספר"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
          else if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') onSave()
        }}
      >
        <h2>עריכת פרטי ספר</h2>
        <label>
          שם הספר
          <input value={title} onChange={(e) => onTitle(e.target.value)} autoFocus />
        </label>
        <label>
          מחבר
          <input value={author} onChange={(e) => onAuthor(e.target.value)} />
        </label>
        <div className="modal-actions">
          <button className="primary" onClick={onSave} disabled={!title.trim()}>
            שמירה
          </button>
          <button onClick={onCancel}>ביטול</button>
        </div>
      </Dialog>
    </div>
  )
}
