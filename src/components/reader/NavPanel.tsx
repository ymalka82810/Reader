import type { ReactNode } from 'react'
import { Panel, Seg } from './shared'

export type NavTab = 'toc' | 'notes'

/** one panel for moving around the book: table of contents, and bookmarks & highlights */
export function NavPanel({ tab, onTab, children }: { tab: NavTab; onTab: (t: NavTab) => void; children: ReactNode }) {
  return (
    <Panel label="ניווט בספר" className="nav">
      <Seg<NavTab>
        value={tab}
        onChange={onTab}
        options={[['toc', 'תוכן עניינים'], ['notes', 'סימניות והדגשות']]}
      />
      {children}
    </Panel>
  )
}
