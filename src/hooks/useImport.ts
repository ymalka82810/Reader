import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { BookMeta } from '../lib/db'
import { importFile, DeferredDuplicate, type DuplicateChoice } from '../lib/importBook'
import { onLaunchFiles, takeSharedFiles } from '../lib/inbox'
import { t } from '../i18n'

export type DupBatch = {
  items: { name: string; title: string; existing: BookMeta; choice: DuplicateChoice }[]
  done: (choices: DuplicateChoice[]) => void
}
export type DupAsk = { file: string; existing: BookMeta; answer: (c: DuplicateChoice) => void }

type Deps = {
  refresh: () => Promise<void>
  setBusy: (msg: string | undefined) => void
  setError: (msg: string | undefined) => void
}

/** importing files: a progress batch, duplicate prompts, and files shared into the app */
export function useImport({ refresh, setBusy, setError }: Deps) {
  const [batch, setBatch] = useState<{ done: number; total: number; deadline?: number }>()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!batch) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [!!batch]) // eslint-disable-line react-hooks/exhaustive-deps
  // a same-title book already exists: waits for the user's choice
  const [dupBatch, setDupBatch] = useState<DupBatch>()
  const [dupDetail, setDupDetail] = useState(false)
  const [dupAsk, setDupAsk] = useState<DupAsk>()

  const addFiles = async (files: FileList | File[]) => {
    setError(undefined)
    const errors: string[] = []
    const list = Array.from(files)
    let started = Date.now()
    setBatch(list.length > 1 ? { done: 0, total: list.length, deadline: undefined } : undefined)
    setNow(started)
    // keep the screen awake while importing; best-effort, released on completion
    let wake: { release(): Promise<void> } | undefined
    const takeWake = () =>
      (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock
        ?.request('screen')
        .then((w) => (wake = w))
        .catch((e) => console.warn('wake lock unavailable', e)) // best-effort: importing works without it
    void takeWake()
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    const deferred: { name: string; err: DeferredDuplicate }[] = []
    for (const [i, f] of list.entries()) {
      // leaving the tab pauses the queue instead of failing the next file; paused time doesn't count towards the ETA
      if (document.visibilityState === 'hidden') {
        const pausedAt = Date.now()
        await new Promise<void>((resolve) => {
          const on = () => {
            if (document.visibilityState !== 'visible') return
            document.removeEventListener('visibilitychange', on)
            resolve()
          }
          document.addEventListener('visibilitychange', on)
        })
        started += Date.now() - pausedAt
        void takeWake()
      }
      try {
        setBusy(t('import.adding', { name: f.name }))
        await importFile(
          f,
          setBusy,
          // in a batch, duplicates wait until the rest are done and are then asked about together
          list.length > 1
            ? async () => 'defer'
            : (existing) => new Promise<DuplicateChoice>((resolve) => setDupAsk({ file: f.name, existing, answer: resolve })),
        )
        await refresh() // show each book as soon as it's done
      } catch (e) {
        if (e instanceof DeferredDuplicate) deferred.push({ name: f.name, err: e })
        else errors.push(`${f.name}: ${e instanceof Error ? e.message : String(e)}`)
      }
      const done = i + 1
      const nowMs = Date.now()
      setNow(nowMs)
      setBatch(
        list.length > 1
          ? { done, total: list.length, deadline: nowMs + ((nowMs - started) / done) * (list.length - done) }
          : undefined,
      )
    }
    if (deferred.length) {
      setBusy(undefined)
      setBatch(undefined)
      setDupDetail(false)
      const choices = await new Promise<DuplicateChoice[]>((done) =>
        setDupBatch({
          items: deferred.map((d) => ({ name: d.name, title: d.err.title, existing: d.err.existing, choice: 'skip' })),
          done,
        }),
      )
      setDupBatch(undefined)
      for (const [i, d] of deferred.entries()) {
        try {
          await d.err.commit(choices[i] ?? 'skip')
        } catch (e) {
          errors.push(`${d.name}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    }
    window.removeEventListener('beforeunload', warn)
    void wake?.release().catch(() => {}) // already released by the browser (e.g. tab was hidden): nothing to do
    setBatch(undefined)
    setBusy(undefined)
    if (errors.length) setError(errors.join('\n'))
    await refresh()
  }

  const addRef = useRef(addFiles)
  useLayoutEffect(() => {
    addRef.current = addFiles
  })
  useEffect(() => {
    takeSharedFiles().then((f) => {
      if (f.length) addRef.current(f)
    })
    onLaunchFiles((f) => addRef.current(f))
  }, [])

  return { addFiles, batch, now, dupBatch, setDupBatch, dupDetail, setDupDetail, dupAsk, setDupAsk }
}
