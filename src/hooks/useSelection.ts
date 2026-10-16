import { useState } from 'react'

const toggled = <T,>(prev: Set<T>, item: T) => {
  const next = new Set(prev)
  if (!next.delete(item)) next.add(item)
  return next
}

/** multi-select mode; folders and books are selected separately (the folder list selects folders, a folder's contents select books) */
export function useSelection() {
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set())

  const toggleSelect = (id: string) => setSelected((prev) => toggled(prev, id))
  const toggleFolder = (key: string) => setSelectedFolders((prev) => toggled(prev, key))
  const exitSelect = () => {
    setSelecting(false)
    setSelected(new Set())
    setSelectedFolders(new Set())
  }

  return { selecting, setSelecting, selected, setSelected, selectedFolders, setSelectedFolders, toggleSelect, toggleFolder, exitSelect }
}
