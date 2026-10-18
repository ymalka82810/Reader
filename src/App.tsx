import { lazy, Suspense, useEffect, useState } from 'react'
import ErrorBoundary from './components/ErrorBoundary'
import Library from './components/Library'
import Reader from './components/Reader'
import { makeBook } from 'foliate-js/view.js'
import { getBook, getBookMeta } from './lib/db'
import { isScriptedBook } from './lib/sandbox'
import type { PageId } from './components/settings/SettingsScreen'

const AudioPlayer = lazy(() => import('./components/AudioPlayer'))
const InteractiveReader = lazy(() => import('./components/InteractiveReader'))

/** an EPUB that declares scripts (an interactive book), which only the sandboxed reader can run */
async function isInteractive(id: string): Promise<boolean> {
  const rec = await getBook(id)
  if (rec?.kind !== 'epub' || rec.fromPdf) return false
  return isScriptedBook(await makeBook(rec.file))
}

export default function App() {
  const [openId, setOpenId] = useState<string | null>(() =>
    // A share/open-with launch must land in the library, not in a restored book.
    new URLSearchParams(location.search).has('share') ? null : sessionStorage.getItem('reader:open'),
  )

  useEffect(() => {
    if (openId) sessionStorage.setItem('reader:open', openId)
    else sessionStorage.removeItem('reader:open')
  }, [openId])

  /** where to open the book instead of its saved position: set when a search result is tapped */
  const [startCfi, setStartCfi] = useState<string>()
  const open = (id: string, cfi?: string) => {
    setStartCfi(cfi)
    setOpenId(id)
  }

  // audiobooks open in the player, everything else in the reader
  const [audioId, setAudioId] = useState<string | null>(null)
  const [interactiveId, setInteractiveId] = useState<string | null>(null)
  /** the reader chose to open the scripted book as a regular one, with its scripts off */
  const [plainId, setPlainId] = useState<string | null>(null)
  const [checked, setChecked] = useState<string | null>(null)
  /** the settings page to open in the library, when the reader sent the user to the settings */
  const [settingsPage, setSettingsPage] = useState<PageId>()
  useEffect(() => {
    if (!openId) return
    let alive = true
    getBookMeta(openId)
      .then(async (m) => {
        const audio = m?.kind === 'audio'
        const interactive = !audio && (await isInteractive(openId).catch(() => false))
        if (!alive) return
        setAudioId(audio ? openId : null)
        setInteractiveId(interactive ? openId : null)
      })
      .catch(() => alive && (setAudioId(null), setInteractiveId(null)))
      .finally(() => alive && setChecked(openId))
    return () => {
      alive = false
    }
  }, [openId])

  if (!openId) return <Library onOpen={open} startSettings={settingsPage} onSettingsClosed={() => setSettingsPage(undefined)} />
  if (checked !== openId) return null
  const close = () => setOpenId(null)
  return (
    <ErrorBoundary key={openId} onClose={close}>
      {audioId === openId ? (
        <Suspense fallback={null}>
          <AudioPlayer id={openId} onClose={close} />
        </Suspense>
      ) : interactiveId === openId && plainId !== openId ? (
        <Suspense fallback={null}>
          <InteractiveReader id={openId} onClose={close} onOpenPlain={() => setPlainId(openId)} />
        </Suspense>
      ) : (
        <Reader
          id={openId}
          startCfi={startCfi}
          onClose={close}
          onSettings={() => {
            setSettingsPage('appearance')
            close()
          }}
        />
      )}
    </ErrorBoundary>
  )
}
