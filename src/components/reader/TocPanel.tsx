import type { FlatTocItem } from './toc'

export function TocList({ toc, currentHref, onGoTo }: { toc: FlatTocItem[]; currentHref: string; onGoTo: (href: string) => void }) {
  if (toc.length === 0) return <p className="muted">אין תוכן עניינים בספר הזה.</p>
  const current = currentHref ? toc.findIndex((t) => t.href === currentHref) : -1
  return (
    <ul className="toc">
      {toc.map((t, i) => (
        <li
          key={i}
          className={i === current ? 'current' : undefined}
          ref={i === current ? (el) => el?.scrollIntoView({ block: 'center' }) : undefined}
          style={{ paddingInlineStart: t.depth * 16 }}
        >
          <button onClick={() => onGoTo(t.href)}>{t.label}</button>
        </li>
      ))}
    </ul>
  )
}
