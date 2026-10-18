import type { Settings } from '../../lib/settings'
import type { SetSetting } from '../../hooks/useAppSettings'
import { t } from '../../i18n'
import { Row, Section } from './parts'

const clamp = (v: number, max: number) => Math.min(max, Math.max(0, Math.round(v) || 0))

/** the targets; the progress, streak and charts are in "reading goals" in the library's ⋯ menu */
export function GoalsPage({ settings, set }: { settings: Settings; set: SetSetting }) {
  return (
    <Section title={t('prefs.targets')}>
      <Row label={t('goals.daily')}>
        <input
          type="number"
          min={0}
          max={1440}
          step={5}
          value={settings.dailyGoalMin}
          aria-label={t('goals.daily')}
          onChange={(e) => set('dailyGoalMin', clamp(e.target.valueAsNumber, 1440))}
        />
      </Row>
      <Row label={t('goals.yearly')}>
        <input
          type="number"
          min={0}
          max={8760}
          step={10}
          value={settings.yearlyGoalHours}
          aria-label={t('goals.yearly')}
          onChange={(e) => set('yearlyGoalHours', clamp(e.target.valueAsNumber, 8760))}
        />
      </Row>
      <small className="muted">{t('prefs.goalsNote')}</small>
    </Section>
  )
}
