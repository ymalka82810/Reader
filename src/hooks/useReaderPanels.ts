import { useCallback, useState } from 'react'
import type { KeyPanel } from './useBookKeys'
import { useLatest } from './useLatest'

export type Panel = KeyPanel | 'edit' | 'dict' | 'translate' | 'quote' | 'end' | 'recap'

/** which side panel of the reader is open (at most one), and the note being edited */
export function useReaderPanels() {
  const [panel, setPanel] = useState<Panel | null>(null)
  /** for handlers attached to the book's documents, which outlive a render */
  const panelRef = useLatest(panel)
  const [editingId, setEditingId] = useState<string | null>(null)
  /** the word the dictionary panel shows, and which Wiktionary edition it comes from */
  const [dict, setDict] = useState<{ word: string; lang: string } | null>(null)

  /** the passage the translation panel shows, its language (empty when unknown) and the language it is translated into */
  const [translation, setTranslation] = useState<{ text: string; source: string; target: string } | null>(null)

  /** the passage the share-as-quote panel shows, with the reader's note on it */
  const [quote, setQuote] = useState<{ text: string; note?: string } | null>(null)

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

  const openTranslate = useCallback((text: string, source: string, target: string) => {
    setTranslation({ text, source, target })
    setPanel('translate')
  }, [])

  const openQuote = useCallback((text: string, note?: string) => {
    setQuote({ text, note })
    setPanel('quote')
  }, [])

  return { panel, panelRef, setPanel, closePanel, togglePanel, editingId, editNote, dict, openDict, translation, openTranslate, quote, openQuote }
}
