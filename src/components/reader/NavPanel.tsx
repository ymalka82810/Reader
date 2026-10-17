import type { ReactNode } from 'react'
import { Panel, Seg } from './shared'
import { t } from '../../i18n'

export type NavTab = 'toc' | 'notes'

/** one panel for moving around the book: table of contents, and bookmarks & highlights */
export function NavPanel({ tab, onTab, children }: { tab: NavTab; onTab: (t: NavTab) => void; children: ReactNode }) {
  return (
    <Panel label={t('nav.title')} className="nav">
      <Seg<NavTab>
        value={tab}
        onChange={onTab}
        options={[['toc', t('nav.toc')], ['notes', t('nav.notes')]]}
      />
      {children}
    </Panel>
  )
}
