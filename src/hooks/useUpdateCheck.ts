import { findUpdate, installUpdate } from '../lib/updater'

const UPDATE_REPO = 'ymalka82810/Reader'

type Deps = {
  setBusy: (msg: string | undefined) => void
  setError: (msg: string | undefined) => void
  showToast: (msg: string, undo?: () => void, ms?: number) => void
}

/** looks for a newer app release on GitHub and installs it after confirmation */
export function useUpdateCheck({ setBusy, setError, showToast }: Deps) {
  return async () => {
    setError(undefined)
    try {
      setBusy('בודק עדכונים…')
      const update = await findUpdate(UPDATE_REPO, 'v')
      if (!update) {
        setBusy(undefined)
        showToast('האפליקציה מעודכנת', undefined, 4000)
        return
      }
      setBusy(undefined)
      if (!confirm(`יש גרסה חדשה (${update.version}). להוריד ולהתקין?`)) return
      const label = 'מוריד עדכון…'
      setBusy(label)
      await installUpdate(update.url, update.sha256, (p) => setBusy(p >= 0 ? `${label} ${Math.round(p)}%` : label))
    } catch (e) {
      setError(`עדכון נכשל: ${e instanceof Error ? e.message : String(e)}`)
    }
    setBusy(undefined)
  }
}
