import { useEffect, useState } from 'react'
import { Dialog } from '../Dialog'
import { localeTag, t } from '../../i18n'
import { formatMinutes } from '../../lib/stats'
import { loadSettings, saveSettings } from '../../lib/settings'
import { currentStreak, dayKey, lastDays, loadReadingLog, weekSummary, type ReadingLog } from '../../lib/readingLog'

const minutes = (secs: number) => Math.round(secs / 60)
const WEEKDAYS = t('goals.weekdays').split(',')

/** daily goal, streak, weekly summary and a per-day chart, fed by the reading log */
export function GoalsDialog({ onClose }: { onClose: () => void }) {
  const [log, setLog] = useState<ReadingLog>()
  const [goal, setGoal] = useState(() => loadSettings().dailyGoalMin)
  const [range, setRange] = useState<7 | 30>(7)

  useEffect(() => {
    loadReadingLog().then(setLog)
  }, [])

  const changeGoal = (v: number) => {
    const n = Math.min(1440, Math.max(0, Math.round(v) || 0))
    setGoal(n)
    saveSettings({ ...loadSettings(), dailyGoalMin: n })
  }

  const [today] = useState(() => dayKey(Date.now()))
  const goalSecs = goal * 60
  const todaySecs = log?.[today] ?? 0
  const week = log && weekSummary(log, goalSecs, today)
  const streak = log ? currentStreak(log, goalSecs, today) : 0
  const days = log ? lastDays(log, range, today) : []
  const max = Math.max(goalSecs, ...days.map((d) => d.secs), 1)

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <Dialog
        className="modal goals"
        role="dialog"
        aria-modal="true"
        aria-label={t('goals.title')}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <h2>{t('goals.title')}</h2>
        <label>
          {t('goals.daily')}
          <input type="number" min={0} max={1440} step={5} value={goal} onChange={(e) => changeGoal(e.target.valueAsNumber)} />
        </label>

        {!log ? (
          <p>{t('common.loading')}</p>
        ) : (
          <>
            <div className="goals-today">
              <span>
                {t('goals.today')} <strong>{formatMinutes(minutes(todaySecs))}</strong>
                {goal > 0 && (todaySecs >= goalSecs ? ` · ${t('goals.met')}` : ` ${t('goals.outOf', { goal: formatMinutes(goal) })}`)}
              </span>
              {goal > 0 && <progress value={Math.min(todaySecs, goalSecs)} max={goalSecs} aria-label={t('goals.progress')} />}
            </div>

            <div className="goals-stats">
              <div>
                <strong>{streak}</strong>
                <small>{t('goals.streak', { n: streak })}</small>
              </div>
              <div>
                <strong>{formatMinutes(minutes(week!.totalSecs))}</strong>
                <small>{t('goals.last7')}</small>
              </div>
              <div>
                <strong>{goal > 0 ? `${week!.goalDays}/7` : `${week!.activeDays}/7`}</strong>
                <small>{goal > 0 ? t('goals.daysMet') : t('goals.daysRead')}</small>
              </div>
            </div>

            <div className="goals-range" role="group" aria-label={t('goals.range')}>
              <button aria-pressed={range === 7} onClick={() => setRange(7)}>
                {t('goals.week')}
              </button>
              <button aria-pressed={range === 30} onClick={() => setRange(30)}>
                {t('goals.days30')}
              </button>
            </div>
            <div className="goals-chart" role="img" aria-label={t('goals.chart', { n: range })}>
              {goal > 0 && <div className="goals-line" style={{ bottom: `${(goalSecs / max) * 100}%` }} />}
              {days.map((d) => {
                const [y, m, dd] = d.key.split('-').map(Number)
                const date = new Date(y!, m! - 1, dd!)
                return (
                  <div
                    key={d.key}
                    className={'goals-bar' + (goal > 0 && d.secs >= goalSecs ? ' met' : '')}
                    title={`${date.toLocaleDateString(localeTag())}: ${formatMinutes(minutes(d.secs))}`}
                  >
                    <span style={{ height: `${(d.secs / max) * 100}%` }} />
                    {range === 7 && <small>{WEEKDAYS[date.getDay()]}</small>}
                  </div>
                )
              })}
            </div>
            {log && Object.keys(log).length === 0 && (
              <small className="goals-note">{t('goals.note')}</small>
            )}
          </>
        )}
        <div className="modal-actions">
          <button className="primary" onClick={onClose} autoFocus>
            {t('common.close')}
          </button>
        </div>
      </Dialog>
    </div>
  )
}
