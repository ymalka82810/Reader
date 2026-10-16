import { useState } from 'react'
import { PasswordRequiredError, WrongPasswordError } from '../lib/encrypt'
import { librarySize, markBackedUp } from '../lib/backupReminder'
import { exportLibrary, exportLibraryTo } from '../lib/backupExport'
import { importLibrary } from '../lib/backupImport'
import { download } from '../lib/download'

/** above this, building the backup in memory risks crashing a phone */
const BIG_BACKUP = 500 * 1024 * 1024

export type PwAsk = { kind: 'export' } | { kind: 'import'; file: File; wrong?: boolean }

type Deps = {
  refresh: () => Promise<void>
  setBusy: (msg: string | undefined) => void
  setError: (msg: string | undefined) => void
  showToast: (msg: string, undo?: () => void, ms?: number) => void
  onBackedUp: () => void
}

/** exporting and restoring a library backup, including the password prompt for encrypted ones */
export function useBackup({ refresh, setBusy, setError, showToast, onBackedUp }: Deps) {
  // password prompt: for a new backup (optional password) or for restoring an encrypted one
  const [pwAsk, setPwAsk] = useState<PwAsk>()
  const [pw, setPw] = useState('')

  const askExport = () => {
    setPw('')
    setPwAsk({ kind: 'export' })
  }

  const doExport = async (password?: string) => {
    setError(undefined)
    const name = `גיבוי-ספרייה-${new Date().toISOString().slice(0, 10)}.readerbackup`
    try {
      // must run first: the save dialog needs the click's user activation, which awaits can use up
      const picker = (window as any).showSaveFilePicker as undefined | ((o: object) => Promise<any>)
      let sink: any
      if (picker) {
        try {
          sink = await (await picker({ suggestedName: name })).createWritable()
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') return
          /* picker unavailable here: fall back to an in-memory download */
        }
      }
      if (!sink) {
        const size = await librarySize()
        if (size > BIG_BACKUP && !confirm(`הספרייה גדולה (${Math.round(size / 1024 / 1024)}MB). הגיבוי נבנה בזיכרון ועלול להיכשל במכשיר חלש. להמשיך?`)) return
      }
      setBusy('מכין גיבוי…')
      const progress = (d: number, t: number) => setBusy(`מכין גיבוי… ${d}/${t}`)
      if (sink) await exportLibraryTo(sink, progress, password)
      else download(await exportLibrary(progress, password), name)
      markBackedUp()
      onBackedUp()
    } catch (e) {
      setError(`גיבוי נכשל: ${e instanceof Error ? e.message : String(e)}`)
    }
    setBusy(undefined)
  }

  const doImport = async (file: File, password?: string) => {
    setError(undefined)
    try {
      setBusy('משחזר גיבוי…')
      const { restored, skipped } = await importLibrary(file, (d, t) => setBusy(`משחזר גיבוי… ${d}/${t}`), password)
      setBusy(undefined)
      showToast(`שוחזרו ${restored} ספרים` + (skipped ? ` (${skipped} כבר היו בספרייה בשם ובמחבר זהים ולא נוספו)` : ''), undefined, 6000)
    } catch (e) {
      setBusy(undefined)
      if (e instanceof PasswordRequiredError || e instanceof WrongPasswordError) {
        setPw('')
        setPwAsk({ kind: 'import', file, wrong: e instanceof WrongPasswordError })
      } else {
        setError(`שחזור נכשל: ${e instanceof SyntaxError ? 'קובץ הגיבוי פגום' : e instanceof Error ? e.message : String(e)}`)
      }
    }
    await refresh()
  }

  const submitPw = () => {
    const ask = pwAsk
    if (!ask) return
    setPwAsk(undefined)
    if (ask.kind === 'export') doExport(pw || undefined)
    else doImport(ask.file, pw)
  }

  return { pwAsk, setPwAsk, pw, setPw, askExport, doImport, submitPw }
}
