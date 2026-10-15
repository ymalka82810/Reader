import { useEffect, useState } from 'react'
import Library from './components/Library'
import Reader from './components/Reader'

export default function App() {
  const [openId, setOpenId] = useState<string | null>(() => sessionStorage.getItem('reader:open'))

  useEffect(() => {
    if (openId) sessionStorage.setItem('reader:open', openId)
    else sessionStorage.removeItem('reader:open')
  }, [openId])

  return openId ? <Reader id={openId} onClose={() => setOpenId(null)} /> : <Library onOpen={setOpenId} />
}
