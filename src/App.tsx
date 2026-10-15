import { useEffect, useState } from 'react'
import ErrorBoundary from './components/ErrorBoundary'
import Library from './components/Library'
import Reader from './components/Reader'

export default function App() {
  const [openId, setOpenId] = useState<string | null>(() =>
    // A share/open-with launch must land in the library, not in a restored book.
    new URLSearchParams(location.search).has('share') ? null : sessionStorage.getItem('reader:open'),
  )

  useEffect(() => {
    if (openId) sessionStorage.setItem('reader:open', openId)
    else sessionStorage.removeItem('reader:open')
  }, [openId])

  if (!openId) return <Library onOpen={setOpenId} />
  const close = () => setOpenId(null)
  return (
    <ErrorBoundary key={openId} onClose={close}>
      <Reader id={openId} onClose={close} />
    </ErrorBoundary>
  )
}
