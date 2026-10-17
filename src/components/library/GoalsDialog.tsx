import { useEffect, useState } from 'react'
import { Dialog } from '../Dialog'
import { formatMinutes } from '../../lib/stats'
import { loadSettings, saveSettings } from '../../lib/settings'
import { currentStreak, dayKey, lastDays, loadReadingLog, weekSummary, type ReadingLog } from '../../lib/readingLog'

const minutes = (secs: number) => Math.round(secs / 60)
const WEEKDAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳']

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
        aria-label="יעדי קריאה"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <h2>יעדי קריאה</h2>
        <label>
          יעד יומי (בדקות, 0 = ללא יעד)
          <input type="number" min={0} max={1440} step={5} value={goal} onChange={(e) => changeGoal(e.target.valueAsNumber)} />
        </label>

        {!log ? (
          <p>טוען…</p>
        ) : (
          <>
            <div className="goals-today">
              <span>
                היום: <strong>{formatMinutes(minutes(todaySecs))}</strong>
                {goal > 0 && (todaySecs >= goalSecs ? ' · היעד הושג ✓' : ` מתוך ${formatMinutes(goal)}`)}
              </span>
              {goal > 0 && <progress value={Math.min(todaySecs, goalSecs)} max={goalSecs} aria-label="התקדמות ליעד היומי" />}
            </div>

            <div className="goals-stats">
              <div>
                <strong>{streak}</strong>
                <small>{streak === 1 ? 'יום ברצף' : 'ימים ברצף'}</small>
              </div>
              <div>
                <strong>{formatMinutes(minutes(week!.totalSecs))}</strong>
                <small>ב־7 הימים האחרונים</small>
              </div>
              <div>
                <strong>{goal > 0 ? `${week!.goalDays}/7` : `${week!.activeDays}/7`}</strong>
                <small>{goal > 0 ? 'ימים שעמדו ביעד' : 'ימים עם קריאה'}</small>
              </div>
            </div>

            <div className="goals-range" role="group" aria-label="טווח הגרף">
              <button aria-pressed={range === 7} onClick={() => setRange(7)}>
                שבוע
              </button>
              <button aria-pressed={range === 30} onClick={() => setRange(30)}>
                30 יום
              </button>
            </div>
            <div className="goals-chart" role="img" aria-label={`זמן קריאה ב־${range} הימים האחרונים`}>
              {goal > 0 && <div className="goals-line" style={{ bottom: `${(goalSecs / max) * 100}%` }} />}
              {days.map((d) => {
                const [y, m, dd] = d.key.split('-').map(Number)
                const date = new Date(y!, m! - 1, dd!)
                return (
                  <div
                    key={d.key}
                    className={'goals-bar' + (goal > 0 && d.secs >= goalSecs ? ' met' : '')}
                    title={`${date.toLocaleDateString('he-IL')}: ${formatMinutes(minutes(d.secs))}`}
                  >
                    <span style={{ height: `${(d.secs / max) * 100}%` }} />
                    {range === 7 && <small>{WEEKDAYS[date.getDay()]}</small>}
                  </div>
                )
              })}
            </div>
            {log && Object.keys(log).length === 0 && (
              <small className="goals-note">הנתונים מתחילים להישמר מהקריאה הבאה.</small>
            )}
          </>
        )}
        <div className="modal-actions">
          <button className="primary" onClick={onClose} autoFocus>
            סגור
          </button>
        </div>
      </Dialog>
    </div>
  )
}
