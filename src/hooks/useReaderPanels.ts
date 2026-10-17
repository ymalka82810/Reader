import { useCallback, useState } from 'react'
import type { KeyPanel } from './useBookKeys'
import { useLatest } from './useLatest'

export type Panel = KeyPanel | 'edit' | 'dict'

/** which side panel of the reader is open (at most one), and the note being edited */
export function useReaderPanels() {
  const [panel, setPanel] = useState<Panel | null>(null)
  /** for handlers attached to the book's documents, which outlive a render */
  const panelRef = useLatest(panel)
  const [editingId, setEditingId] = useState<string | null>(null)
  /** the word the dictionary panel shows, and which Wiktionary edition it comes from */
  const [dict, setDict] = useState<{ word: string; lang: string } | null>(null)

  const closePanel = useCallback(() => setPanel(null), [])
  const togglePanel = useCallback((p: Panel) => setPanel((cur) => (cur === p ? null : p)), [])
  const editNote = useCallback((noteId: string) => {
    setEditingId(noteId)
    setPanel('edit')
  }, [])

  const openDict = useCallback((word: string, lang: string) => {
    setDict({ word, lang })
    setPanel('dict')
  }, [])

  return { panel, panelRef, setPanel, closePanel, togglePanel, editingId, editNote, dict, openDict }
}
