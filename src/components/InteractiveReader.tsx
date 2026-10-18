import { useCallback, useEffect, useRef, useState } from 'react'
import { makeBook } from 'foliate-js/view.js'
import { flattenToc, type FlatTocItem } from './reader/toc'
import { getBook } from '../lib/db'
import { classifyLink, parseSandboxMessage, toSandboxHtml, type SandboxCommand } from '../lib/sandbox'
import { t } from '../i18n'

interface Section {
  load: () => Promise<string | null>
  unload?: () => void
  resolveHref: (href: string) => string
}
interface InteractiveBook {
  title?: string | { [lang: string]: string }
  dir?: string
  toc?: Parameters<typeof flattenToc>[0]
  sections: Section[]
  resolveHref: (href: string) => { index: number } | null
  metadata?: { title?: string | { [lang: string]: string } }
}

const posKey = (id: string) => `reader:interactive:${id}`
const savedIndex = (id: string) => {
  try {
    return Math.max(0, Number(localStorage.getItem(posKey(id))) || 0)
  } catch {
    return 0
  }
}

/**
 * Opens a scripted EPUB: each chapter runs in the sandboxed page interactive.html (opaque origin, no network),
 * talking to this component only through the checked messages of lib/sandbox. Highlights, selection and the
 * dictionary need access to the chapter's document, which the sandbox deliberately denies, so they are off here.
 */
export default function InteractiveReader({ id, onClose, onOpenPlain }: { id: string; onClose: () => void; onOpenPlain: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const book = useRef<InteractiveBook | null>(null)
  const [title, setTitle] = useState('')
  const [toc, setToc] = useState<FlatTocItem[]>([])
  const [count, setCount] = useState(0)
  const [index, setIndex] = useState(() => savedIndex(id))
  const [error, setError] = useState('')
  /** HTML of the current chapter, waiting for the sandbox page to ask for it */
  const pending = useRef('')

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const rec = await getBook(id)
        if (!rec) throw new Error(t('reader.bookMissing'))
        const b = (await makeBook(rec.file)) as InteractiveBook
        if (!alive) return
        book.current = b
        setTitle(rec.title)
        setToc(flattenToc(b.toc))
        setCount(b.sections.length)
        setIndex((i) => Math.min(i, b.sections.length - 1))
      } catch (e) {
        console.error(e)
        if (alive) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      alive = false
    }
  }, [id])

  // load chapter `index`: its HTML (resources as blob: URLs) is prepared here and handed to a fresh sandbox page
  useEffect(() => {
    const b = book.current
    const f = frame.current
    if (!b || !f || !count) return
    let alive = true
    const section = b.sections[index]
    if (!section) return
    ;(async () => {
      try {
        const url = await section.load()
        if (!url || !alive) return
        const blob = await (await fetch(url)).blob()
        if (!alive) return
        pending.current = await toSandboxHtml(await blob.text(), blob.type)
        if (!alive) return
        f.src = new URL('interactive.html', document.baseURI).href
      } catch (e) {
        console.error(e)
        if (alive) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    try {
      localStorage.setItem(posKey(id), String(index))
    } catch {
      /* position is a convenience only */
    }
    return () => {
      alive = false
      section.unload?.()
    }
  }, [id, index, count])

  const go = useCallback((i: number) => setIndex((cur) => (i >= 0 && i < count ? i : cur)), [count])

  // everything the book's scripts can say to the reader passes through here
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const f = frame.current
      if (!f || e.source !== f.contentWindow) return
      const m = parseSandboxMessage(e.data)
      if (!m) return
      if (m.type === 'shell-ready') {
        const cmd: SandboxCommand = { source: 'reader', type: 'load', html: pending.current }
        // the sandboxed page has an opaque origin, so the only possible target origin is '*'
        f.contentWindow?.postMessage(cmd, '*')
      } else if (m.type === 'link') {
        const kind = classifyLink(m.href)
        if (kind === 'web') window.open(m.href, '_blank', 'noopener,noreferrer')
        else if (kind === 'book') {
          const b = book.current
          const target = b?.sections[index] && b.resolveHref(b.sections[index].resolveHref(m.href))
          if (target && target.index >= 0) go(target.index)
        }
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [index, go])

  return (
    <div className="reader interactive-reader">
      <div className="topbar">
        <button type="button" onClick={onClose}>
          {t('reader.backToLibrary')}
        </button>
        <h1 className="title">{title}</h1>
        {toc.length > 0 && (
          <select
            aria-label={t('interactive.chapter')}
            value=""
            onChange={(e) => {
              const target = book.current?.resolveHref(e.target.value)
              if (target) go(target.index)
            }}
          >
            <option value="" disabled>
              {t('interactive.chapter')}
            </option>
            {toc.map((item, i) => (
              <option key={i} value={item.href}>
                {'  '.repeat(item.depth)}
                {item.label}
              </option>
            ))}
          </select>
        )}
        <button type="button" onClick={() => go(index - 1)} disabled={index <= 0}>
          {t('interactive.prev')}
        </button>
        <button type="button" onClick={() => go(index + 1)} disabled={index >= count - 1}>
          {t('interactive.next')}
        </button>
      </div>
      <div className="interactive-note" role="note">
        {t('interactive.note')}{' '}
        <button type="button" onClick={onOpenPlain}>
          {t('interactive.openPlain')}
        </button>
      </div>
      {error ? (
        <p role="alert" className="interactive-error">
          {error}
        </p>
      ) : (
        <iframe
          ref={frame}
          className="interactive-frame"
          title={title}
          // scripts only: no same-origin (opaque origin), no popups, forms, modals or top navigation
          sandbox="allow-scripts"
          allow=""
          referrerPolicy="no-referrer"
        />
      )}
    </div>
  )
}
