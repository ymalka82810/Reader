import { useEffect, useState } from 'react'
import { isRtl, t } from '../../i18n'
import { useAppSettings } from '../../hooks/useAppSettings'
import { useBackGesture } from '../../hooks/useBackGesture'
import { useLatest } from '../../hooks/useLatest'
import { Dialog } from '../Dialog'
import { AboutPage } from './AboutPage'
import { BackupPage, type BackupActions } from './BackupPage'
import { LanguagePage } from './LanguagePage'
import './settings.css'

export type PageId = 'language' | 'backup' | 'about'

const PAGES: [PageId, string][] = [
  ['language', t('prefs.page.language')],
  ['backup', t('prefs.page.backup')],
  ['about', t('prefs.page.about')],
]

/** the navigation is a side list from this width up, and a list that opens each page on narrower screens */
const WIDE = '(min-width: 720px)'

function useWide() {
  const [wide, setWide] = useState(() => matchMedia(WIDE).matches)
  useEffect(() => {
    const mq = matchMedia(WIDE)
    const on = () => setWide(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return wide
}

type Props = {
  onClose: () => void
  /** the backup actions the library lends to the backup page */
  backup: BackupActions
  onCheckUpdate: () => void
  startPage?: PageId
}

/** full-screen settings: pages in a list, with each page's settings in sections */
export function SettingsScreen({ onClose, backup, onCheckUpdate, startPage }: Props) {
  const wide = useWide()
  const [settings, set] = useAppSettings()
  const [page, setPage] = useState<PageId | null>(startPage ?? null)
  const current = page ?? (wide ? PAGES[0]![0] : null)

  // the phone's back swipe goes from a page back to the list first, and closes the settings from the list
  const state = useLatest({ page, wide })
  const leave = useBackGesture(() => {
    if (state.current.page && !state.current.wide) {
      setPage(null)
      return true
    }
    onClose()
    return false
  })
  const close = () => {
    leave()
    onClose()
  }

  const title = PAGES.find(([id]) => id === current)?.[1]
  const showList = wide || !current
  return (
    <Dialog
      className="prefs"
      role="dialog"
      aria-modal="true"
      aria-label={t('prefs.title')}
      onKeyDown={(e) => e.key === 'Escape' && !e.defaultPrevented && close()}
    >
      <header className="prefs-head">
        {current && !wide && (
          <button aria-label={t('prefs.back')} onClick={() => setPage(null)}>
            {isRtl() ? '→' : '←'}
          </button>
        )}
        <h2>{wide || !title ? t('prefs.title') : title}</h2>
        <button className="prefs-close" aria-label={t('prefs.close')} onClick={close}>
          ✕
        </button>
      </header>
      <div className="prefs-body">
        {showList && (
          <nav className="prefs-nav" aria-label={t('prefs.nav')}>
            {PAGES.map(([id, label]) => (
              <button key={id} aria-current={id === current ? 'page' : undefined} onClick={() => setPage(id)}>
                {label}
              </button>
            ))}
          </nav>
        )}
        {current && (
          <div className="prefs-page" role="region" aria-label={title}>
            {wide && <h2>{title}</h2>}
            {current === 'language' && <LanguagePage settings={settings} set={set} />}
            {current === 'backup' && <BackupPage actions={backup} leave={close} />}
            {current === 'about' && <AboutPage busy={backup.busy} onCheckUpdate={() => { close(); onCheckUpdate() }} />}
          </div>
        )}
      </div>
    </Dialog>
  )
}
