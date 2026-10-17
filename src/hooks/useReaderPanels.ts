import { useCallback, useState } from 'react'
import type { KeyPanel } from './useBookKeys'
import { useLatest } from './useLatest'

export type Panel = KeyPanel | 'edit'

/** which side panel of the reader is open (at most one), and the note being edited */
export function useReaderPanels() {
  const [panel, setPanel] = useState<Panel | null>(null)
  /** for handlers attached to the book's documents, which outlive a render */
  const panelRef = useLatest(panel)
  const [editingId, setEditingId] = useState<string | null>(null)

  const closePanel = useCallback(() => setPanel(null), [])
  const togglePanel = useCallback((p: Panel) => setPanel((cur) => (cur === p ? null : p)), [])
  const editNote = useCallback((noteId: string) => {
    setEditingId(noteId)
    setPanel('edit')
  }, [])

  return { panel, panelRef, setPanel, closePanel, togglePanel, editingId, editNote }
}
