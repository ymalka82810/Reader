import { useEffect, useRef, useState } from 'react'
import type { BookMeta } from '../../lib/db'

export function Cover({ book }: { book: BookMeta }) {
  const [url, setUrl] = useState<string>()
  const holder = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined')
  // Only materialise the cover blob once the card is near the viewport.
  useEffect(() => {
    const el = holder.current
    if (visible || !el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true)
          io.disconnect()
        }
      },
      { rootMargin: '300px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [visible])
  useEffect(() => {
    if (!visible || !book.cover) return
    const u = URL.createObjectURL(book.cover)
    // oxlint-disable-next-line react/set-state-in-effect -- syncs an object URL, an external resource
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [visible, book.cover])
  if (url) return <img className="cover" src={url} alt="" decoding="async" />
  return (
    <div className="cover placeholder" ref={holder}>
      <span>{book.title}</span>
    </div>
  )
}
