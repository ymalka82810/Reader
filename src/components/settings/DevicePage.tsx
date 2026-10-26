import { useEffect, useRef, useState } from 'react'
import type { Settings } from '../../lib/settings'
import type { SetSetting } from '../../hooks/useAppSettings'
import {
  hasDeviceAccess,
  normalizeFolder,
  pickDeviceFolder,
  requestDeviceAccess,
  requestNotificationAccess,
  scanDevice,
  syncBackgroundScan,
} from '../../lib/deviceBooks'
import { t } from '../../i18n'
import { listBooks } from '../../lib/db'
import { pendingVersionCount, phoneFileLinks, placeBooksOnPhone, placeVersions } from '../../lib/phoneFiles'
import { identifyFiles } from '../../lib/fileIdentity'
import { summarizePhone, type PhoneOverview } from '../../lib/phoneOverview'
import { PhoneOverviewDialog } from './PhoneOverviewDialog'
import { findDuplicateGroups, type DuplicateGroup } from '../../lib/phoneDuplicates'
import { PhoneDuplicatesDialog } from './PhoneDuplicatesDialog'
import { mergeAllAuthorSpellings } from '../../lib/authorMerge'
import { useConfirm } from '../../hooks/useConfirm'
import { ConfirmDialog } from '../library/Dialogs'
import { Row, Section, Toggle } from './parts'

/** Android app: the books already on the phone — access, automatic scan, the folders looked through */
export function DevicePage({ settings, set, busy, onScan }: { settings: Settings; set: SetSetting; busy: boolean; onScan: (retry?: boolean) => void }) {
  const [access, setAccess] = useState<boolean>()
  const [error, setError] = useState('')
  const [bgNote, setBgNote] = useState('')
  const [placing, setPlacing] = useState<string>()
  const [placingBusy, setPlacingBusy] = useState(false)
  const [dupes, setDupes] = useState<DuplicateGroup[]>()
  const [dupesBusy, setDupesBusy] = useState(false)
  const stopLooking = useRef<AbortController>(undefined)
  const [overview, setOverview] = useState<{ data: PhoneOverview; pending: number; groups: DuplicateGroup[] }>()
  const { pending: confirmAsk, confirm } = useConfirm()
  useEffect(() => {
    // re-checked on return, since access is given (or taken away) in Android's own settings
    const check = () => document.visibilityState === 'visible' && void hasDeviceAccess().then(setAccess)
    check()
    document.addEventListener('visibilitychange', check)
    return () => document.removeEventListener('visibilitychange', check)
  }, [])

  const allow = async () => {
    setError('')
    try {
      setAccess(await requestDeviceAccess())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const toggleBackground = async (on: boolean) => {
    setBgNote('')
    set('deviceBackgroundScan', on)
    // the announcement is a notification, so the permission is asked for right when the user turns this on
    if (on && !(await requestNotificationAccess())) setBgNote(t('device.notifOff'))
    await syncBackgroundScan({ deviceBackgroundScan: on, deviceFolders: settings.deviceFolders })
  }

  /** every book of the library into the books folder, in its folder's sub-folder (also the ones from before the folder existed) */
  const organiseAll = async () => {
    setError('')
    const ids = (await listBooks().catch(() => [])).map((b) => b.id)
    if (!ids.length) return setPlacing(t('device.libraryFolderNone'))
    if (!(await confirm({ title: t('device.libraryFolderAll'), text: t('device.libraryFolderAllAsk', { n: ids.length }), ok: t('device.libraryFolderAllOk'), cancel: t('common.cancel') }))) return
    setPlacingBusy(true)
    setPlacing(t('device.libraryFolderBusy', { done: 0, n: ids.length }))
    // one author spelt several ways would get a folder for each spelling: put right first
    await mergeAllAuthorSpellings().catch(() => 0)
    const { placed, failed } = await placeBooksOnPhone(ids, (done, n) => setPlacing(t('device.libraryFolderBusy', { done, n }))).finally(() => setPlacingBusy(false))
    setPlacing(failed ? t('device.libraryFolderDoneFailed', { placed, failed }) : t('device.libraryFolderDone', { placed }))
  }

  const folders = settings.deviceFolders
  /** the scanned folders' books that are there more than once: each file is compared as a book is when it is added (its own
   *  title and author), one the library follows by the library's name; shows how far it is, and can be cancelled */
  const lookForDuplicates = async () => {
    const ctl = new AbortController()
    stopLooking.current = ctl
    const [files, links] = await Promise.all([scanDevice(folders), phoneFileLinks()])
    const identities = await identifyFiles(files, await listBooks(), links, {
      signal: ctl.signal,
      onProgress: (done, n) => setPlacing(t('device.identifying', { done, n })),
    })
    setPlacing(undefined)
    return { files, linked: new Set(links.keys()), groups: findDuplicateGroups(files, new Set(links.keys()), identities) }
  }
  /** what the scanned folders hold: counted, shown, and from there the converted copies are filed or the duplicates cleaned */
  const showOverview = async () => {
    setError('')
    setPlacing(undefined)
    setDupesBusy(true)
    try {
      const [{ files, linked, groups }, pending] = await Promise.all([lookForDuplicates(), pendingVersionCount()])
      setOverview({ data: summarizePhone(files, linked, groups), pending, groups })
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setError(e instanceof Error ? e.message : String(e))
      setPlacing(undefined)
    } finally {
      setDupesBusy(false)
    }
  }
  /** the books that are in the scanned folders more than once: shown to the user, who approves what is deleted */
  const checkDuplicates = async () => {
    setError('')
    setPlacing(undefined)
    setDupesBusy(true)
    try {
      const { groups: found } = await lookForDuplicates()
      if (found.length) setDupes(found)
      else setPlacing(t('device.dupesNone'))
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setError(e instanceof Error ? e.message : String(e))
      setPlacing(undefined)
    } finally {
      setDupesBusy(false)
    }
  }
  const addFolder = async () => {
    setError('')
    try {
      const picked = await pickDeviceFolder()
      if (picked === undefined) return
      const f = normalizeFolder(picked)
      if (!folders.includes(f)) set('deviceFolders', [...folders, f])
    } catch (e) {
      setError(e instanceof Error && e.message === 'not local' ? t('device.notLocal') : String(e instanceof Error ? e.message : e))
    }
  }
  const name = (f: string) => f || t('device.allStorage')

  return (
    <>
      <Section title={t('device.section')}>
        <small className="muted">{t('device.intro')}</small>
        <Row label={access ? t('device.accessGranted') : t('device.accessMissing')} hint={t('device.accessHint')}>
          {access === false && <button onClick={allow}>{t('device.accessOk')}</button>}
        </Row>
        <Toggle
          label={t('device.auto')}
          hint={t('device.autoHint')}
          checked={settings.deviceAutoScan}
          onChange={(v) => set('deviceAutoScan', v)}
        />
        <Toggle
          label={t('device.bg')}
          hint={t('device.bgHint')}
          checked={settings.deviceBackgroundScan}
          onChange={(v) => void toggleBackground(v)}
        />
        <Toggle
          label={t('device.libraryFolder')}
          hint={t('device.libraryFolderHint')}
          checked={settings.phoneLibraryFolder}
          onChange={(v) => set('phoneLibraryFolder', v)}
        />
        {settings.phoneLibraryFolder && (
          <Row label={t('device.libraryFolderAll')} hint={t('device.libraryFolderAllHint')}>
            <button disabled={busy || access === false || placingBusy} onClick={() => void organiseAll()}>
              {t('device.libraryFolderAllButton')}
            </button>
          </Row>
        )}
        {placing && <div role="status" className="muted">{placing}</div>}
        {dupesBusy && <button onClick={() => stopLooking.current?.abort()}>{t('device.identifyCancel')}</button>}
        <Toggle
          label={t('device.renameSync')}
          hint={t('device.renameSyncHint')}
          checked={settings.phoneRenameSync}
          onChange={(v) => set('phoneRenameSync', v)}
        />
        <Row label={t('device.scanNow')} hint={t('device.scanNowHint')}>
          <button disabled={busy || !folders.length} onClick={() => onScan()}>{t('device.scanNow')}</button>
        </Row>
        <Row label={t('device.retry')} hint={t('device.retryHint')}>
          <button disabled={busy || !folders.length} onClick={() => onScan(true)}>{t('device.retryButton')}</button>
        </Row>
        <Row label={t('device.overview')} hint={t('device.overviewHint')}>
          <button disabled={busy || dupesBusy || access === false || !folders.length} onClick={() => void showOverview()}>
            {t('device.overviewButton')}
          </button>
        </Row>
        <Row label={t('device.dupes')} hint={t('device.dupesHint')}>
          <button disabled={busy || dupesBusy || access === false || !folders.length} onClick={() => void checkDuplicates()}>
            {t('device.dupesButton')}
          </button>
        </Row>
        {bgNote && <div role="alert" className="muted">{bgNote}</div>}
      </Section>
      <Section title={t('device.folders')}>
        {folders.length ? (
          folders.map((f) => (
            <Row key={f} label={name(f)}>
              <button aria-label={t('device.removeFolder', { name: name(f) })} onClick={() => set('deviceFolders', folders.filter((x) => x !== f))}>
                ✕
              </button>
            </Row>
          ))
        ) : (
          <small className="muted">{t('device.noFolders')}</small>
        )}
        <Row label={t('device.addFolder')}>
          <button onClick={addFolder}>{t('device.addFolder')}</button>
        </Row>
        {error && <div role="alert" className="muted">{error}</div>}
      </Section>
      {overview && (
        <PhoneOverviewDialog
          overview={overview.data}
          pending={overview.pending}
          onFile={placeVersions}
          onClean={() => {
            setDupes(overview.groups)
            setOverview(undefined)
          }}
          onClose={() => setOverview(undefined)}
        />
      )}
      {dupes && (
        <PhoneDuplicatesDialog
          groups={dupes}
          onDone={(msg) => {
            setDupes(undefined)
            setPlacing(msg)
          }}
          onClose={() => setDupes(undefined)}
        />
      )}
      {confirmAsk && <ConfirmDialog ask={confirmAsk} />}
    </>
  )
}
