import { lazy, Suspense, useEffect, useState } from 'react'
import ErrorBoundary from './components/ErrorBoundary'
import Library from './components/Library'
import Reader from './components/Reader'
import { getBookMeta } from './lib/db'

const AudioPlayer = lazy(() => import('./components/AudioPlayer'))

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
  const [checked, setChecked] = useState<string | null>(null)
  useEffect(() => {
    if (!openId) return
    let alive = true
    getBookMeta(openId)
      .then((m) => alive && setAudioId(m?.kind === 'audio' ? openId : null))
      .catch(() => alive && setAudioId(null))
      .finally(() => alive && setChecked(openId))
    return () => {
      alive = false
    }
  }, [openId])

  if (!openId) return <Library onOpen={open} />
  if (checked !== openId) return null
  const close = () => setOpenId(null)
  return (
    <ErrorBoundary key={openId} onClose={close}>
      {audioId === openId ? (
        <Suspense fallback={null}>
          <AudioPlayer id={openId} onClose={close} />
        </Suspense>
      ) : (
        <Reader id={openId} startCfi={startCfi} onClose={close} />
      )}
    </ErrorBoundary>
  )
}
