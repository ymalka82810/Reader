import { useEffect, useState } from 'react'
import { Dialog } from '../Dialog'
import { localeTag, t } from '../../i18n'
import { formatMinutes } from '../../lib/stats'
import { loadSettings } from '../../lib/settings'
import {
  currentStreak,
  dayKey,
  heatLevel,
  heatmapWeeks,
  weekDays,
  monthDays,
  loadReadingHours,
  loadReadingLog,
  weekdayHourMatrix,
  weekSummary,
  yearProgress,
  type ReadingHours,
  type ReadingLog,
} from '../../lib/readingLog'

const minutes = (secs: number) => Math.round(secs / 60)
const WEEKDAYS = t('goals.weekdays').split(',')

/** daily goal, streak, weekly summary and a per-day chart, fed by the reading log */
export function GoalsDialog({ onClose, onSettings }: { onClose: () => void; onSettings: () => void }) {
  const [log, setLog] = useState<ReadingLog>()
  const [{ dailyGoalMin: goal, yearlyGoalHours: yearGoal }] = useState(loadSettings)
  const [hours, setHours] = useState<ReadingHours>()
  const [range, setRange] = useState<7 | 'month'>(7)

  useEffect(() => {
    loadReadingLog().then(setLog)
    loadReadingHours().then(setHours)
  }, [])

  const [today] = useState(() => dayKey(Date.now()))
  const goalSecs = goal * 60
  const todaySecs = log?.[today] ?? 0
  const week = log && weekSummary(log, goalSecs, today)
  const streak = log ? currentStreak(log, goalSecs, today) : 0
  const days = log ? (range === 7 ? weekDays(log, today) : monthDays(log, today)) : []
  // headroom so the minutes label above the tallest bar stays inside the chart
  const max = Math.max(goalSecs, ...days.map((d) => d.secs), 1) * 1.2
  const year = log && yearProgress(log, today)
  const weeks = log ? heatmapWeeks(log, today) : []
  const heatMax = Math.max(...weeks.flat().map((c) => c?.secs ?? 0), 0)
  const matrix = hours && weekdayHourMatrix(hours)
  const matrixMax = matrix ? Math.max(...matrix.flat(), 0) : 0

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
        {goal === 0 && yearGoal === 0 && <small className="goals-note">{t('prefs.goalsNone')}</small>}

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
              <button aria-pressed={range === 'month'} onClick={() => setRange('month')}>
                {t('goals.month')}
              </button>
            </div>
            <div className="goals-chart" role="img" aria-label={t('goals.chart', { n: days.length })}>
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
                    {d.secs > 0 && (
                      <em style={{ bottom: `${(d.secs / max) * 100}%` }}>
                        {range === 7 ? formatMinutes(minutes(d.secs)) : minutes(d.secs)}
                      </em>
                    )}
                    <span style={{ height: `${(d.secs / max) * 100}%` }} />
                    {range === 7 && <small>{WEEKDAYS[date.getDay()]}</small>}
                  </div>
                )
              })}
            </div>
            {yearGoal > 0 && (
              <div className="goals-today">
                <span>{t('goals.yearProgress', { done: Math.round((year!.secs / 3600) * 10) / 10, goal: yearGoal })}</span>
                <progress value={Math.min(year!.secs, yearGoal * 3600)} max={yearGoal * 3600} aria-label={t('goals.progress')} />
                <small className="goals-note">{t('goals.yearProjected', { n: Math.round(year!.projectedSecs / 3600) })}</small>
              </div>
            )}

            <h3>{t('goals.heatmap')}</h3>
            <div className="heat-year" role="img" aria-label={t('goals.heatmap')}>
              {weeks.flat().map((c, i) => (
                <i
                  key={i}
                  className={c ? `lv${heatLevel(c.secs, heatMax)}` : 'none'}
                  title={c ? `${c.key}: ${formatMinutes(minutes(c.secs))}` : undefined}
                />
              ))}
            </div>
            <div className="heat-legend" aria-hidden="true">
              <small>{t('goals.less')}</small>
              {[0, 1, 2, 3, 4].map((l) => (
                <i key={l} className={`lv${l}`} />
              ))}
              <small>{t('goals.more')}</small>
            </div>

            {matrix && matrixMax > 0 && (
              <>
                <h3>{t('goals.hours')}</h3>
                <div className="heat-hours" role="img" aria-label={t('goals.hours')}>
                  {matrix.map((row, wd) =>
                    row.map((secs, h) => (
                      <i
                        key={`${wd}-${h}`}
                        className={`lv${heatLevel(secs, matrixMax)}`}
                        title={`${WEEKDAYS[wd]} ${String(h).padStart(2, '0')}:00 · ${formatMinutes(minutes(secs))}`}
                      />
                    )),
                  )}
                </div>
              </>
            )}
            {log && Object.keys(log).length === 0 && (
              <small className="goals-note">{t('goals.note')}</small>
            )}
          </>
        )}
        <div className="modal-actions">
          <button onClick={onSettings}>{t('prefs.goalsEdit')}</button>
          <button className="primary" onClick={onClose} autoFocus>
            {t('common.close')}
          </button>
        </div>
      </Dialog>
    </div>
  )
}
