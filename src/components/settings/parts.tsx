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

/** one setting: its name and an optional explanation on the start side, the control on the other */
export function Row({ label, hint, children }: { label: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="prefs-row">
      <div className="prefs-label">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </div>
      {children && <div className="prefs-control">{children}</div>}
    </div>
  )
}
