/** Save a blob as a file. The link joins the page first (Firefox and some mobile browsers ignore a detached one),
 *  and revoking is deferred: Safari/Firefox can drop the download if the URL dies right after click(). */
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    a.remove()
    URL.revokeObjectURL(url)
  }, 60_000)
}
