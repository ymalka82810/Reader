import type { Folder } from '../../lib/folders'

const bookCount = (n: number) => (!n ? 'ריקה' : n === 1 ? 'ספר אחד' : `${n} ספרים`)

type ListProps = {
  folders: Folder[]
  selecting: boolean
  selectedFolders: Set<string>
  onOpen: (key: string) => void
  onToggle: (key: string) => void
}

/** the grid of folders shown at the top level of the library */
export function FolderList({ folders, selecting, selectedFolders, onOpen, onToggle }: ListProps) {
  return (
    <ul className="grid folders">
      {folders.map((f) => (
        <li key={f.key}>
          <button
            className={'card folder' + (selectedFolders.has(f.key) ? ' selected' : '')}
            aria-pressed={selecting ? selectedFolders.has(f.key) : undefined}
            onClick={() => (selecting ? onToggle(f.key) : onOpen(f.key))}
          >
            <div className="folder-icon" aria-hidden="true">📁</div>
            <div className="meta">
              <small className="kind">תיקייה</small>
              <strong>{f.name || 'ללא מחבר'}</strong>
              <small>{bookCount(f.books.length)}</small>
            </div>
          </button>
          {selecting && <span className="sel-mark" aria-hidden="true">{selectedFolders.has(f.key) ? '☑' : '☐'}</span>}
        </li>
      ))}
    </ul>
  )
}

type BarProps = {
  folder: Folder
  onBack: () => void
  onRename: () => void
  onDelete: () => void
}

/** the header above the books of the folder being viewed */
export function FolderBar({ folder, onBack, onRename, onDelete }: BarProps) {
  return (
    <div className="folder-bar">
      <button onClick={onBack}>→ כל התיקיות</button>
      <strong>📁 {folder.name || 'ללא מחבר'}</strong>
      <small>{folder.books.length === 1 ? 'ספר אחד' : `${folder.books.length} ספרים`}</small>
      {folder.key && <button onClick={onRename}>שינוי שם</button>}
      <button className="danger" onClick={onDelete}>מחק תיקייה</button>
    </div>
  )
}
