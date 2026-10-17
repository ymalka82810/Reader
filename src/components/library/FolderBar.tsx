import type { Folder } from '../../lib/folders'
import { BookCard, type BookActions } from './BookGrid'
import { Cover } from './Cover'

const bookCount = (n: number) => (!n ? 'ריקה' : n === 1 ? 'ספר אחד' : `${n} ספרים`)

type ListProps = {
  folders: Folder[]
  /** keys of folders that only hold one book their author put there: shown as that book's card */
  loose: Set<string>
  bookActions: Omit<BookActions, 'selecting' | 'onToggle'>
  selecting: boolean
  selectedFolders: Set<string>
  onOpen: (key: string) => void
  onToggle: (key: string) => void
}

/** the grid of folders shown at the top level of the library */
export function FolderList({ folders, loose, bookActions, selecting, selectedFolders, onOpen, onToggle }: ListProps) {
  return (
    <ul className="grid folders">
      {folders.map((f) => {
        const lone = loose.has(f.key) ? f.books[0] : undefined
        if (lone)
          return (
            <BookCard
              key={f.key}
              book={lone}
              picked={selectedFolders.has(f.key)}
              selecting={selecting}
              onToggle={() => onToggle(f.key)}
              {...bookActions}
            />
          )
        // the folder wears the cover of the first book that has one
        const covered = f.books.find((b) => b.cover)
        return (
        <li key={f.key}>
          <button
            className={'card folder' + (covered ? ' covered' : '') + (selectedFolders.has(f.key) ? ' selected' : '')}
            aria-pressed={selecting ? selectedFolders.has(f.key) : undefined}
            onClick={() => (selecting ? onToggle(f.key) : onOpen(f.key))}
          >
            {covered ? (
              <div className="cover-wrap">
                <Cover book={covered} />
                <span className="folder-badge" aria-hidden="true">📁</span>
              </div>
            ) : (
              <div className="folder-icon" aria-hidden="true">📁</div>
            )}
            <div className="meta">
              <small className="kind">תיקייה</small>
              <strong>{f.name || 'ללא מחבר'}</strong>
              <small>{bookCount(f.books.length)}</small>
            </div>
          </button>
          {selecting && <span className="sel-mark" aria-hidden="true">{selectedFolders.has(f.key) ? '☑' : '☐'}</span>}
        </li>
        )
      })}
    </ul>
  )
}

type BarProps = {
  folder: Folder
  /** absent when it is the only folder */
  onBack?: () => void
  onRename: () => void
  onDelete: () => void
}

/** the header above the books of the folder being viewed */
export function FolderBar({ folder, onBack, onRename, onDelete }: BarProps) {
  return (
    <div className="folder-bar">
      <div className="folder-title">
        <strong>📁 {folder.name || 'ללא מחבר'}</strong>
        <small>{folder.books.length === 1 ? 'ספר אחד' : `${folder.books.length} ספרים`}</small>
      </div>
      <div className="folder-actions">
        {onBack && <button onClick={onBack}>→ כל התיקיות</button>}
        {folder.key && <button onClick={onRename}>שינוי שם</button>}
        <button className="danger" onClick={onDelete}>מחק תיקייה</button>
      </div>
    </div>
  )
}
