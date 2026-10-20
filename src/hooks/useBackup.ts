import { useState } from 'react'
import { PasswordRequiredError, WrongPasswordError } from '../lib/encrypt'
import { librarySize, markBackedUp } from '../lib/backupReminder'
import { exportLibrary, exportLibraryTo } from '../lib/backupExport'
import { importLibrary } from '../lib/backupImport'
import { download } from '../lib/download'
import { deviceBooksSupported } from '../lib/deviceBooks'
import { openDownloadsFolder, saveBlobToPhone } from '../lib/phoneFiles'
import { t } from '../i18n'
import type { Confirm } from './useConfirm'

/** above this, building the backup in memory risks crashing a phone */
const BIG_BACKUP = 500 * 1024 * 1024

type BackupSink = Parameters<typeof exportLibraryTo>[0]

/** the File System Access API's save dialog, which not every browser has (and isn't in the DOM typings) */
type SaveFilePickerWindow = Window & {
  showSaveFilePicker?: (o: { suggestedName: string }) => Promise<{ createWritable(): Promise<BackupSink> }>
}

export type PwAsk = { kind: 'export' } | { kind: 'import'; file: File; wrong?: boolean }

type Deps = {
  refresh: () => Promise<void>
  setBusy: (msg: string | undefined) => void
  setError: (msg: string | undefined) => void
  showToast: (msg: string, undo?: () => void, ms?: number) => void
  onBackedUp: () => void
  confirm: Confirm
}

/** exporting and restoring a library backup, including the password prompt for encrypted ones */
export function useBackup({ refresh, setBusy, setError, showToast, onBackedUp, confirm }: Deps) {
  // password prompt: for a new backup (optional password) or for restoring an encrypted one
  const [pwAsk, setPwAsk] = useState<PwAsk>()
  const [pw, setPw] = useState('')

  const askExport = () => {
    setPw('')
    setPwAsk({ kind: 'export' })
  }

  const doExport = async (password?: string) => {
    setError(undefined)
    const name = `${t('backup.fileName')}-${new Date().toISOString().slice(0, 10)}.readerbackup`
    try {
      // must run first: the save dialog needs the click's user activation, which awaits can use up
      const picker = (window as SaveFilePickerWindow).showSaveFilePicker
      let sink: BackupSink | undefined
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
        const ask = {
          title: t('backup.bigTitle', { mb: Math.round(size / 1024 / 1024) }),
          text: t('backup.bigText'),
          ok: t('common.continue'),
        }
        if (size > BIG_BACKUP && !(await confirm(ask))) return
      }
      setBusy(t('backup.preparing'))
      const progress = (done: number, total: number) => setBusy(`${t('backup.preparing')} ${done}/${total}`)
      let savedName = name
      if (sink) await exportLibraryTo(sink, progress, password)
      else if (deviceBooksSupported()) {
        // the app's WebView does not save downloaded files: write it to the phone's Download folder
        const blob = await exportLibrary(progress, password)
        setBusy(t('backup.saving'))
        savedName = await saveBlobToPhone(blob, name)
      } else download(await exportLibrary(progress, password), name)
      markBackedUp()
      onBackedUp()
      setBusy(undefined)
      if (deviceBooksSupported() && !sink) {
        const open = await confirm({
          title: t('backup.doneTitle'),
          text: t('backup.doneText', { name: savedName }),
          ok: t('book.openLocation'),
          cancel: t('common.close'),
        })
        if (open) await openDownloadsFolder().catch(() => {})
      } else showToast(t('backup.done', { name: savedName }), undefined, 6000)
    } catch (e) {
      const code = e instanceof Error ? e.message : String(e)
      setError(t('backup.failed', { msg: code === 'permission' ? t('book.savePermission') : code === 'save' ? t('book.saveWrite') : code }))
    }
    setBusy(undefined)
  }

  const doImport = async (file: File, password?: string) => {
    setError(undefined)
    try {
      setBusy(t('backup.restoring'))
      const { restored, skipped } = await importLibrary(file, (done, total) => setBusy(`${t('backup.restoring')} ${done}/${total}`), password)
      setBusy(undefined)
      showToast(t('backup.restored', { n: restored }) + (skipped ? ` (${t('backup.skipped', { n: skipped })})` : ''), undefined, 6000)
    } catch (e) {
      setBusy(undefined)
      if (e instanceof PasswordRequiredError || e instanceof WrongPasswordError) {
        setPw('')
        setPwAsk({ kind: 'import', file, wrong: e instanceof WrongPasswordError })
      } else {
        setError(t('backup.restoreFailed', { msg: e instanceof SyntaxError ? t('backup.corrupt') : e instanceof Error ? e.message : String(e) }))
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
