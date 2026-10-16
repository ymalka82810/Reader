import type { FlatTocItem } from './toc'

export function TocList({ toc, onGoTo }: { toc: FlatTocItem[]; onGoTo: (href: string) => void }) {
  if (toc.length === 0) return <p className="muted">אין תוכן עניינים בספר הזה.</p>
  return (
    <ul className="toc">
      {toc.map((t, i) => (
        <li key={i} style={{ paddingInlineStart: t.depth * 16 }}>
          <button onClick={() => onGoTo(t.href)}>{t.label}</button>
        </li>
      ))}
    </ul>
  )
}
