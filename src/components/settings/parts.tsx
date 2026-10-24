import { useId, type ReactNode } from 'react'

/** a titled group of rows inside a settings page */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId()
  return (
    <section className="prefs-section" aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      {children}
    </section>
  )
}

function Label({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="prefs-label">
      <span>{label}</span>
      {hint && <small>{hint}</small>}
    </div>
  )
}

/** one setting: its name and an optional explanation on the start side, the control on the other (`stacked`: control below, full width, for wide inputs) */
export function Row({ label, hint, stacked, children }: { label: string; hint?: string; stacked?: boolean; children?: ReactNode }) {
  return (
    <div className={stacked ? 'prefs-row prefs-row-stacked' : 'prefs-row'}>
      <Label label={label} hint={hint} />
      {children && <div className="prefs-control">{children}</div>}
    </div>
  )
}

/** an on/off setting: the whole row is the checkbox's label */
export function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="prefs-row prefs-toggle">
      <Label label={label} hint={hint} />
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}
