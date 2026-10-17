import { findUpdate, installUpdate } from '../lib/updater'
import type { Confirm } from './useConfirm'
import { t } from '../i18n'

const UPDATE_REPO = 'ymalka82810/Reader'

type Deps = {
  setBusy: (msg: string | undefined) => void
  setError: (msg: string | undefined) => void
  showToast: (msg: string, undo?: () => void, ms?: number) => void
  confirm: Confirm
}

/** looks for a newer app release on GitHub and installs it after confirmation */
export function useUpdateCheck({ setBusy, setError, showToast, confirm }: Deps) {
  return async () => {
    setError(undefined)
    try {
      setBusy(t('update.checking'))
      const update = await findUpdate(UPDATE_REPO, 'v')
      if (!update) {
        setBusy(undefined)
        showToast(t('update.upToDate'), undefined, 4000)
        return
      }
      setBusy(undefined)
      if (!(await confirm({ title: t('update.newTitle'), text: t('update.newText', { version: update.version }), ok: t('update.install') }))) return
      const label = t('update.downloading')
      setBusy(label)
      await installUpdate(update.url, update.sha256, (p) => setBusy(p >= 0 ? `${label} ${Math.round(p)}%` : label))
    } catch (e) {
      setError(t('update.failed', { msg: e instanceof Error ? e.message : String(e) }))
    }
    setBusy(undefined)
  }
}
