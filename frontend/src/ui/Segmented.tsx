import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface SegmentOption<T extends string> { value: T; label: ReactNode }

/** Pill-style single choice (e.g. Intern | New grad). Keyboard: native radio semantics. */
export function Segmented<T extends string>({ value, onChange, options, label, className }: {
  value: T
  onChange: (v: T) => void
  options: SegmentOption<T>[]
  label: string
  className?: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex h-8 shrink-0 rounded-md border border-line bg-canvas p-0.5', className)}>
      {options.map(o => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={cn('flex items-center gap-1.5 rounded px-3 text-[13px] font-medium whitespace-nowrap transition-colors',
            value === o.value ? 'bg-raised text-fg shadow-sm' : 'text-subtle hover:text-muted')}>
          {o.label}
        </button>
      ))}
    </div>
  )
}
