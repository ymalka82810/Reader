import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { BookMeta } from '../lib/db'
import { rememberPhoneFile } from '../lib/phoneFiles'
import { importFile, isAbort, isAlreadyInLibrary, DeferredDuplicate, type DuplicateChoice } from '../lib/importBook'
import { onLaunchFiles, takeSharedFiles } from '../lib/inbox'
import { startImportService, stopImportService, updateImportService } from '../lib/deviceBooks'
import { identifyNew } from '../lib/autoIdentify'
import { loadSettings } from '../lib/settings'
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
  /** called after each item that was added, skipped or failed; not for one that was cancelled, which is not dealt with */
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
  // Android app: a foreground service keeps the app alive while it is not on the screen, so the queue carries on
  // instead of pausing, and the ongoing notification shows its progress (no-op in the browser)
  let kept = false
  let lastKey = ''
  let lastAt = 0
  const showProgress = () => {
    if (!kept) return
    const b = state.batch
    const text = state.dupAsk || state.dupBatch ? t('import.bgAsk') : (state.message ?? '')
    const key = `${b?.done}/${b?.total}|${text}`
    const now = Date.now()
    if (key === lastKey || now - lastAt < 1000) return
    lastKey = key
    lastAt = now
    updateImportService(b ? `${t('import.bgTitle')} (${b.done}/${b.total})` : t('import.bgTitle'), text, b?.done ?? 0, b?.total ?? 0)
  }
  const service = startImportService(t('import.bgTitle'), '').then((ok) => {
    kept = ok
    showProgress() // what happened while the service was starting
    return ok
  })
  const unwatch = subscribe(showProgress)
  const warn = (e: BeforeUnloadEvent) => e.preventDefault()
  window.addEventListener('beforeunload', warn)
  const deferred: { name: string; err: DeferredDuplicate }[] = []
  /** the books added by this run, identified at its end */
  const added: string[] = []
  // entries can be added while this loop runs
  for (let i = 0; i < entries.length && !signal.aborted; i++) {
    const entry = entries[i]!
    const { item, skipDuplicates, onEach } = entry
    if (entry.cancelled) {
      // cancelled while waiting: not dealt with, so a scan of the phone offers it again
      run.processed = i + 1
      setState({ queue: queueOf(run), batch: entries.length > 1 ? { done: i + 1, total: entries.length } : undefined })
      continue
    }
    // leaving the tab pauses the queue instead of failing the next file; paused time doesn't count towards the ETA
    if (document.visibilityState === 'hidden') await service // whether the service holds the app decides if the queue pauses
    if (document.visibilityState === 'hidden' && !kept) {
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
      added.push(rec.id)
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
    if (!own.signal.aborted) onEach?.() // a book cancelled while being added is not dealt with either
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
  if (deferred.length && !signal.aborted) {
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
      if (signal.aborted) break
      const choice = choices[i] ?? 'skip'
      if (choice !== 'skip') setState({ message: t('import.adding', { name: d.name }) })
      try {
        // a converted book is converted again here (it isn't kept while waiting), so it reports progress and can be cancelled
        const rec = await d.err.commit(choice, (message) => setState({ message }), signal)
        if (rec) added.push(rec.id)
      } catch (e) {
        if (signal.aborted) break
        errors.push(`${d.name}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }
  // the new books are identified while the queue still holds the app (and its notification) in the background
  if (added.length && !signal.aborted && loadSettings().autoIdentify) {
    setState({ batch: undefined, queue: [], dupAsk: undefined, message: t('identify.autoProgress', { done: 1, total: added.length }) })
    try {
      const { saved, pending } = await identifyNew(added, signal, (done, total) =>
        setState({ message: t('identify.autoProgress', { done: Math.min(done + 1, total), total }) }),
      )
      if (saved) handlers?.showToast?.(t('identify.autoSaved', { n: saved }))
      else if (pending) handlers?.showToast?.(t('identify.autoPending', { n: pending }))
    } catch {
      /* cancelled with the queue: the books stay as they were added */
    }
  }
  const cancelled = signal.aborted // also while the duplicates were being asked about or added
  window.removeEventListener('beforeunload', warn)
  unwatch()
  void service.then((ok) => ok && stopImportService()) // also when the queue ended before the service had started
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
