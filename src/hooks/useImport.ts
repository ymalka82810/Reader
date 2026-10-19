import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { BookMeta } from '../lib/db'
import { rememberPhoneFile } from '../lib/phoneFiles'
import { importFile, isAbort, isAlreadyInLibrary, DeferredDuplicate, type DuplicateChoice } from '../lib/importBook'
import { onLaunchFiles, takeSharedFiles } from '../lib/inbox'
import { t } from '../i18n'

export type DupBatch = {
  items: { name: string; title: string; existing: BookMeta; choice: DuplicateChoice }[]
  done: (choices: DuplicateChoice[]) => void
}
/** a file read only when its turn comes, so a long batch from the phone isn't held in memory all at once */
export type LazyFile = {
  name: string
  load: () => Promise<File>
  /** a book found on the phone: where its file is, so the file can follow the book's name later */
  devicePath?: string
}

export type AddOptions = {
  /** books from a scan of the phone: a book the library already has is skipped without asking or reporting it */
  skipDuplicates?: boolean
  /** called after each item, whether it was added, skipped or failed */
  onEach?: (index: number) => void
}

export type DupAsk = { file: string; existing: BookMeta; answer: (c: DuplicateChoice) => void }

type Deps = {
  refresh: () => Promise<void>
  setError: (msg: string | undefined) => void
  showToast?: (msg: string) => void
}

type Batch = { done: number; total: number; deadline?: number }
/** a book still to be added (or being added now), as the screen lists it */
type QueueItem = { id: number; name: string; active: boolean }
type State = {
  /** the queue is working; the library stays usable meanwhile */
  running: boolean
  /** what the current book is going through ("reading", "counting"…) */
  message?: string
  batch?: Batch
  /** the books not finished yet, each of which can be cancelled alone */
  queue: QueueItem[]
  /** a same-title book already exists: waits for the user's choice */
  dupBatch?: DupBatch
  dupDetail: boolean
  dupAsk?: DupAsk
}

/*
 * The queue lives outside React, so it keeps going when the library is left (a book is opened to read) and
 * is picked up again, with its progress, when the library comes back. The screen only shows it.
 */
let state: State = { running: false, dupDetail: false, queue: [] }
const listeners = new Set<() => void>()
const setState = (patch: Partial<State>) => {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}

/** the library on screen: where books are refreshed and errors shown (none while a book is being read) */
let handlers: Deps | undefined
/** what finished while no library was on screen, shown when the next one mounts */
let pendingError: string | undefined

type Entry = { id: number; item: File | LazyFile; skipDuplicates?: boolean; onEach?: () => void; cancelled?: boolean; ctrl?: AbortController }
type Run = { entries: Entry[]; ctrl: AbortController; done: Promise<void>; processed: number; activeId?: number }
let nextId = 0

const queueOf = (run: Run): QueueItem[] =>
  run.entries
    .slice(run.processed)
    .filter((e) => !e.cancelled)
    .map((e) => ({ id: e.id, name: e.item.name, active: e.id === run.activeId }))
let current: Run | undefined

/** Adds files to the queue: starts it, or joins the one already running (its progress then covers them too). */
function enqueue(files: FileList | (File | LazyFile)[], { skipDuplicates, onEach }: AddOptions = {}): Promise<void> {
  const entries: Entry[] = Array.from(files).map((item, i) => ({ id: nextId++, item, skipDuplicates, onEach: onEach && (() => onEach(i)) }))
  if (current) {
    current.entries.push(...entries)
    // a single file shows no progress bar; with more joining, the bar counts them all
    if (entries.length) setState({ batch: { done: current.processed, total: current.entries.length }, queue: queueOf(current) })
    return current.done
  }
  const ctrl = new AbortController()
  const run: Run = { entries, ctrl, done: Promise.resolve(), processed: 0 }
  current = run
  run.done = work(run).finally(() => {
    current = undefined
  })
  return run.done
}

/** stops one book: while it waits it is simply skipped, while it is being added it is dropped without a trace; the rest go on */
function cancelOne(id: number) {
  const e = current?.entries.find((x) => x.id === id)
  if (!e || e.cancelled) return
  e.cancelled = true
  e.ctrl?.abort()
  if (current?.activeId === id) state.dupAsk?.answer('skip') // its question, if it is waiting on one
  if (current) setState({ queue: queueOf(current) })
}

/** stops the queue: the book in progress is dropped without a trace, the ones already added stay, the rest are not read */
function cancel() {
  if (current) setState({ message: t('import.cancelling'), batch: undefined, queue: [] }) // shown at once, before the work behind it winds down
  current?.ctrl.abort()
  // a question waiting for an answer would hold the queue open
  state.dupAsk?.answer('skip')
  state.dupBatch?.done(state.dupBatch.items.map(() => 'skip'))
}

async function work(run: Run) {
  const { entries, ctrl } = run
  const { signal } = ctrl
  handlers?.setError(undefined)
  pendingError = undefined
  const errors: string[] = []
  let started = Date.now()
  setState({ running: true, message: undefined, batch: entries.length > 1 ? { done: 0, total: entries.length } : undefined, queue: queueOf(run) })
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
  // entries can be added while this loop runs
  for (let i = 0; i < entries.length && !signal.aborted; i++) {
    const entry = entries[i]!
    const { item, skipDuplicates, onEach } = entry
    if (entry.cancelled) {
      // cancelled while waiting: counted as dealt with, like a book the user said no to
      onEach?.()
      run.processed = i + 1
      setState({ queue: queueOf(run), batch: entries.length > 1 ? { done: i + 1, total: entries.length } : undefined })
      continue
    }
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
    // this book's own switch, which the whole queue's switch also throws
    const own = new AbortController()
    entry.ctrl = own
    const stopWithQueue = () => own.abort()
    signal.addEventListener('abort', stopWithQueue, { once: true })
    run.activeId = entry.id
    try {
      setState({ message: t('import.adding', { name: item.name }), queue: queueOf(run) })
      const f = 'load' in item ? await item.load() : item
      own.signal.throwIfAborted()
      const several = entries.length > 1
      const rec = await importFile(
        f,
        (message) => setState({ message }),
        skipDuplicates
          ? async () => 'skip'
          : // in a batch, duplicates wait until the rest are done and are then asked about together
            several
            ? async () => 'defer'
            : (existing) => new Promise<DuplicateChoice>((resolve) => setState({ dupAsk: { file: f.name, existing, answer: resolve } })),
        own.signal,
      )
      if ('devicePath' in item && item.devicePath) await rememberPhoneFile(rec.id, item.devicePath).catch(() => {})
      await handlers?.refresh() // show each book as soon as it's done
    } catch (e) {
      if (signal.aborted) break // the whole queue was cancelled: not a failure, and not worth reporting per file
      // only this book was cancelled: nothing to report, on to the next
      if (!(own.signal.aborted || isAbort(e))) {
        if (e instanceof DeferredDuplicate) deferred.push({ name: item.name, err: e })
        else if (!(skipDuplicates && isAlreadyInLibrary(e))) errors.push(`${item.name}: ${e instanceof Error ? e.message : String(e)}`)
      }
    } finally {
      signal.removeEventListener('abort', stopWithQueue)
      run.activeId = undefined
      entry.ctrl = undefined
    }
    onEach?.()
    const done = (run.processed = i + 1)
    const nowMs = Date.now()
    setState({
      dupAsk: undefined,
      queue: queueOf(run),
      batch:
        entries.length > 1
          ? { done, total: entries.length, deadline: nowMs + ((nowMs - started) / done) * (entries.length - done) }
          : undefined,
    })
  }
  const cancelled = signal.aborted
  if (deferred.length && !cancelled) {
    setState({ message: undefined, batch: undefined, dupDetail: false })
    const choices = await new Promise<DuplicateChoice[]>((done) =>
      setState({
        dupBatch: {
          items: deferred.map((d) => ({ name: d.name, title: d.err.title, existing: d.err.existing, choice: 'skip' })),
          done,
        },
      }),
    )
    setState({ dupBatch: undefined })
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
  setState({ running: false, message: undefined, batch: undefined, dupAsk: undefined, queue: [] })
  const error = errors.length ? errors.join('\n') : undefined
  if (error) {
    if (handlers) handlers.setError(error)
    else pendingError = error
  }
  if (cancelled) handlers?.showToast?.(t('import.cancelled'))
  await handlers?.refresh()
}

/** importing files: a queue that works in the background and can be cancelled, duplicate prompts, and files shared into the app */
export function useImport(deps: Deps) {
  const s = useSyncExternalStore(subscribe, () => state)
  const [now, setNow] = useState(() => Date.now())
  const ticking = !!s.batch
  useEffect(() => {
    if (!ticking) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [ticking])

  // the latest library on screen receives the refreshes and errors; a finished import's error waits for it
  useLayoutEffect(() => {
    handlers = deps
    if (pendingError) {
      deps.setError(pendingError)
      pendingError = undefined
    }
    return () => {
      if (handlers === deps) handlers = undefined
    }
  })

  const addFiles = useCallback((files: FileList | (File | LazyFile)[], opts?: AddOptions) => enqueue(files, opts), [])
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

  return {
    addFiles,
    cancel,
    cancelOne,
    queue: s.queue,
    running: s.running,
    message: s.message,
    batch: s.batch,
    now,
    dupBatch: s.dupBatch,
    setDupBatch: (dupBatch: DupBatch | undefined) => setState({ dupBatch }),
    dupDetail: s.dupDetail,
    setDupDetail: (dupDetail: boolean) => setState({ dupDetail }),
    dupAsk: s.dupAsk,
    setDupAsk: (dupAsk: DupAsk | undefined) => setState({ dupAsk }),
  }
}
