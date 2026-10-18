import { useState } from 'react'
import { applyA11yClasses, loadSettings, saveSettings, type Settings } from '../lib/settings'

/** the display settings as state: every change is saved, and the app-wide accessibility classes are re-applied */
export function useAppSettings() {
  const [settings, setSettings] = useState(loadSettings)
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    const next = { ...loadSettings(), [k]: v }
    saveSettings(next)
    applyA11yClasses(next)
    setSettings(next)
  }
  return [settings, set] as const
}

export type SetSetting = ReturnType<typeof useAppSettings>[1]
