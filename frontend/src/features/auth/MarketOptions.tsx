import { cn } from '@/lib/cn'
import { MARKETS, type Market } from '@/lib/markets'

/** The three job-market choices as large radio cards. */
export function MarketOptions({ value, onChange, name = 'job_market' }: { value: Market | null; onChange: (m: Market) => void; name?: string }) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-[13px] text-muted">Where are you looking for jobs?</legend>
      {MARKETS.map(m => (
        <label key={m.value}
          className={cn('flex cursor-pointer items-start gap-3 rounded-[4px] border px-3.5 py-3 transition-colors',
            value === m.value ? 'border-accent bg-accent-soft' : 'border-line-strong hover:bg-hover')}>
          <input type="radio" name={name} value={m.value} checked={value === m.value} onChange={() => onChange(m.value)}
            className="mt-1 size-4 shrink-0 accent-[var(--ui-accent)]" />
          <span>
            <span className="block text-[14px] font-medium text-fg">{m.label}</span>
            <span className="block text-[12px] text-muted">{m.description}</span>
          </span>
        </label>
      ))}
    </fieldset>
  )
}
