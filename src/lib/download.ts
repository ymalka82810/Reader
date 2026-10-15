/** Save a blob as a file. Revoking is deferred: Safari/Firefox can drop the download if the URL dies right after click(). */
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
