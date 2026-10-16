import { Dialog } from '../Dialog'


/** stroked 24px SVG icon, so toolbar buttons look the same on every platform */
export function Icon({ d, filled = false }: { d: string; filled?: boolean }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" width="20" height="20" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

/** floating panel: see Dialog — takes focus on open, traps Tab, returns focus to its opener on close */
export function Panel({ label, className = '', children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <Dialog className={`panel ${className}`} role="dialog" aria-label={label}>
      {children}
    </Dialog>
  )
}

export function Seg<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: [T, string][]
}) {
  return (
    <div className="seg">
      {options.map(([v, label]) => (
        <button key={v} className={v === value ? 'on' : ''} aria-pressed={v === value} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  )
}
