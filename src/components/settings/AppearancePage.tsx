import { useEffect, useState } from 'react'
import { loadCustomFont, removeCustomFont, saveCustomFont, type CustomFont } from '../../lib/customFont'
import type { Settings, VolumeKeys } from '../../lib/settings'
import type { NightMode, NightTheme } from '../../lib/nightMode'
import { deviceCoords, sunTimes } from '../../lib/sun'
import { isNativeApp } from '../../lib/updater'
import { Select } from '../Select'
import type { SetSetting } from '../../hooks/useAppSettings'
import { localeTag, t } from '../../i18n'
import { Row, Section, Toggle } from './parts'

/** the reading look that is set once: spacing, column, margins, alignment, the custom theme's colors and the custom font.
 *  What changes while reading (size, line height, theme, brightness, flow) stays in the reader's Aa panel. */
export function AppearancePage({ settings, set }: { settings: Settings; set: SetSetting }) {
  const [font, setFont] = useState<CustomFont>()
  const [fontError, setFontError] = useState('')
  useEffect(() => {
    let alive = true
    void loadCustomFont().then((f) => alive && setFont(f))
    return () => {
      alive = false
    }
  }, [])

  const upload = async (file: File | undefined) => {
    if (!file) return
    try {
      setFont(await saveCustomFont(file))
      set('fontFamily', 'custom')
      setFontError('')
    } catch (e) {
      setFontError(e instanceof Error ? e.message : t('settings.fontFailed'))
    }
  }
  const drop = async () => {
    await removeCustomFont()
    setFont(undefined)
    if (settings.fontFamily === 'custom') set('fontFamily', 'default')
  }

  return (
    <>
      <Section title={t('prefs.textSection')}>
        <Row label={t('settings.letterSpacing')}>
          <input
            type="range"
            min={0}
            max={0.2}
            step={0.01}
            value={settings.letterSpacing}
            aria-label={t('settings.letterSpacing')}
            onChange={(e) => set('letterSpacing', parseFloat(e.target.value))}
          />
        </Row>
        <Row label={t('settings.columnWidth')}>
          <input
            type="range"
            min={320}
            max={1200}
            step={20}
            value={settings.columnWidth || 720}
            aria-label={t('settings.columnWidth')}
            onChange={(e) => set('columnWidth', parseInt(e.target.value))}
          />
          <button onClick={() => set('columnWidth', 0)} aria-label={t('settings.columnAutoLabel')} disabled={!settings.columnWidth}>
            {t('settings.columnAuto')}
          </button>
        </Row>
        <Row label={t('settings.margins')}>
          <input
            type="range"
            min={0}
            max={20}
            step={1}
            value={settings.margin}
            aria-label={t('settings.margins')}
            onChange={(e) => set('margin', parseInt(e.target.value))}
          />
        </Row>
        <Toggle label={t('settings.justify')} checked={settings.justify} onChange={(on) => set('justify', on)} />
        <Toggle label={t('settings.bookStyles')} hint={t('settings.bookStylesNote')} checked={settings.bookStyles} onChange={(on) => set('bookStyles', on)} />
      </Section>

      <Section title={t('prefs.pagesSection')}>
        <Toggle label={t('settings.pageAnim')} hint={t('prefs.pageAnimNote')} checked={settings.pageTransition} onChange={(on) => set('pageTransition', on)} />
        {isNativeApp && (
          <Row label={t('prefs.volumeKeys')} hint={t('prefs.volumeKeysNote')}>
            <Select<VolumeKeys>
              label={t('prefs.volumeKeys')}
              value={settings.volumeKeys}
              onChange={(v) => set('volumeKeys', v)}
              options={[
                ['down-next', t('prefs.volumeKeys.downNext')],
                ['up-next', t('prefs.volumeKeys.upNext')],
                ['off', t('prefs.volumeKeys.off')],
              ]}
            />
          </Row>
        )}
      </Section>

      <NightSection settings={settings} set={set} />

      <Section title={t('prefs.colorsSection')}>
        <small className="muted">{t('prefs.colorsNote')}</small>
        <Row label={t('settings.bg')}>
          <input type="color" value={settings.customBg} aria-label={t('settings.bg')} onChange={(e) => set('customBg', e.target.value)} />
        </Row>
        <Row label={t('settings.fg')}>
          <input type="color" value={settings.customFg} aria-label={t('settings.fg')} onChange={(e) => set('customFg', e.target.value)} />
        </Row>
        <Row label={t('settings.links')}>
          <input type="color" value={settings.customLink} aria-label={t('settings.links')} onChange={(e) => set('customLink', e.target.value)} />
        </Row>
      </Section>

      <Section title={t('prefs.fontSection')}>
        <small className="muted">{t('prefs.fontNote')}</small>
        <Row label={font ? font.name : t('prefs.noFont')}>
          <label className="upload">
            {t('settings.uploadFont')}
            <input type="file" accept=".ttf,.otf,.woff,.woff2" hidden onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = '' }} />
          </label>
          {font && <button onClick={() => void drop()}>{t('settings.removeFont')}</button>}
        </Row>
        {fontError && <div role="alert" className="muted">{fontError}</div>}
      </Section>
    </>
  )
}

/** today's sunset and sunrise where the device's time zone says it is, as a line for the settings */
function sunLine(): string {
  const [lat, lon] = deviceCoords()
  const sun = sunTimes(new Date(), lat, lon)
  if (sun.kind !== 'normal') return t(sun.kind === 'night' ? 'night.polarNight' : 'night.polarDay')
  const fmt = new Intl.DateTimeFormat(localeTag(), { hour: '2-digit', minute: '2-digit' })
  return t('night.sunToday', { set: fmt.format(sun.set), rise: fmt.format(sun.rise) })
}

/** night mode: when it comes on, which theme the book takes, and how warm the screen gets */
function NightSection({ settings, set }: { settings: Settings; set: SetSetting }) {
  const on = settings.nightMode !== 'off'
  return (
    <Section title={t('night.title')}>
      <Row label={t('night.when')} hint={t('night.whenNote')}>
        <Select<NightMode>
          label={t('night.when')}
          value={settings.nightMode}
          onChange={(v) => set('nightMode', v)}
          options={[
            ['off', t('night.off')],
            ['sun', t('night.sun')],
            ['schedule', t('night.schedule')],
          ]}
        />
      </Row>
      {settings.nightMode === 'sun' && <small className="muted">{sunLine()}</small>}
      {settings.nightMode === 'schedule' && (
        <>
          <Row label={t('night.start')}>
            <input type="time" value={settings.nightStart} aria-label={t('night.start')} onChange={(e) => e.target.value && set('nightStart', e.target.value)} />
          </Row>
          <Row label={t('night.end')}>
            <input type="time" value={settings.nightEnd} aria-label={t('night.end')} onChange={(e) => e.target.value && set('nightEnd', e.target.value)} />
          </Row>
        </>
      )}
      {on && (
        <>
          <Row label={t('night.theme')}>
            <Select<NightTheme>
              label={t('night.theme')}
              value={settings.nightTheme}
              onChange={(v) => set('nightTheme', v)}
              options={[
                ['dark', t('theme.dark')],
                ['sepia', t('theme.sepia')],
                ['custom', t('theme.custom')],
              ]}
            />
          </Row>
          <Row label={t('night.warmth')} hint={t('night.warmthNote')}>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.nightWarmth}
              aria-label={t('night.warmth')}
              onChange={(e) => set('nightWarmth', parseFloat(e.target.value))}
            />
          </Row>
        </>
      )}
    </Section>
  )
}
