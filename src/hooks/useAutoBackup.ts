import { useCallback, useEffect, useState } from 'react'
import {
  autoBackupDue,
  autoBackupState,
  chooseBackupFolder,
  disableAutoBackup,
  lastAutoBackup,
  runAutoBackup,
  type AutoBackupState,
} from '../lib/autoBackup'
import { t } from '../i18n'

type Deps = {
  setError: (msg: string | undefined) => void
  showToast: (msg: string, undo?: () => void, ms?: number) => void
}

/** daily automatic backup into a chosen folder: runs on launch when due, and exposes the menu actions */
export function useAutoBackup({ setError, showToast }: Deps) {
  const [state, setState] = useState<AutoBackupState>('unsupported')
  const [last, setLast] = useState(lastAutoBackup())

  const refreshState = useCallback(async () => {
    setState(await autoBackupState())
    setLast(lastAutoBackup())
  }, [])

  const run = useCallback(
    async (interactive: boolean) => {
      try {
        if (await runAutoBackup(interactive)) {
          if (interactive) showToast(t('autoBackup.saved'))
        }
      } catch (e) {
        setError(t('autoBackup.failed', { msg: e instanceof Error ? e.message : String(e) }))
      }
      await refreshState()
    },
    [refreshState, setError, showToast],
  )

  useEffect(() => {
    autoBackupState().then((s) => {
      setState(s)
      if (s === 'ready' && autoBackupDue()) run(false)
    })
    // only on launch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const enable = async () => {
    try {
      if (!(await chooseBackupFolder())) return
    } catch (e) {
      setError(t('autoBackup.pickFailed', { msg: e instanceof Error ? e.message : String(e) }))
      return
    }
    await run(true)
  }

  const disable = async () => {
    await disableAutoBackup()
    await refreshState()
    showToast(t('autoBackup.off'))
  }

  return { state, last, enable, disable, renew: () => run(true) }
}
