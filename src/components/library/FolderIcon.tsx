/** a folder glyph drawn as SVG, so it looks the same on every platform; sized by the parent's font-size */
export function FolderIcon() {
  return (
    <svg className="folder-svg" viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true">
      <path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z" />
    </svg>
  )
}
