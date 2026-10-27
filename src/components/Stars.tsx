import { t } from '../i18n'

/** 1–5 stars: tapping a star sets that rating, tapping the current one clears it. Read-only without `onRate`. */
export function Stars({ value, onRate, small }: { value: number; onRate?: (r: number) => void; small?: boolean }) {
  const cls = 'stars' + (small ? ' small' : '')
  if (!onRate)
    return (
      <span className={cls} role="img" aria-label={t('rating.of', { n: value })}>
        {[1, 2, 3, 4, 5].map((n) => (
          <i key={n} className={n <= value ? 'on' : undefined} aria-hidden="true">
            ★
          </i>
        ))}
      </span>
    )
  return (
    <span className={cls} role="radiogroup" aria-label={t('rating.label')}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={n === value}
          aria-label={t('rating.stars', { n })}
          className={n <= value ? 'on' : undefined}
          onClick={() => onRate(n === value ? 0 : n)}
        >
          ★
        </button>
      ))}
    </span>
  )
}
