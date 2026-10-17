import type { FlatTocItem } from './toc'
import { t } from '../../i18n'

export function TocList({ toc, currentHref, onGoTo }: { toc: FlatTocItem[]; currentHref: string; onGoTo: (href: string) => void }) {
  if (toc.length === 0) return <p className="muted">{t('toc.none')}</p>
  const current = currentHref ? toc.findIndex((item) => item.href === currentHref) : -1
  return (
    <ul className="toc">
      {toc.map((item, i) => (
        <li
          key={i}
          className={i === current ? 'current' : undefined}
          ref={i === current ? (el) => el?.scrollIntoView({ block: 'center' }) : undefined}
          style={{ paddingInlineStart: item.depth * 16 }}
        >
          <button onClick={() => onGoTo(item.href)}>{item.label}</button>
        </li>
      ))}
    </ul>
  )
}
