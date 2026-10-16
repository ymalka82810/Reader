import { Panel } from './shared'
import type { FlatTocItem } from './toc'


export function TocPanel({ toc, onGoTo }: { toc: FlatTocItem[]; onGoTo: (href: string) => void }) {
  return (
    <Panel label="תוכן עניינים">
      <h3>תוכן עניינים</h3>
      {toc.length === 0 && <p className="muted">אין תוכן עניינים בספר הזה.</p>}
      <ul className="toc">
        {toc.map((t, i) => (
          <li key={i} style={{ paddingInlineStart: t.depth * 16 }}>
            <button onClick={() => onGoTo(t.href)}>{t.label}</button>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
