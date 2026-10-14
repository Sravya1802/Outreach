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
    <div role="radiogroup" aria-label={label} className={cn('inline-flex h-9 shrink-0 rounded-full border border-line-strong p-0.5', className)}>
      {options.map(o => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={cn('flex items-center gap-1.5 rounded-full px-3.5 text-[13px] whitespace-nowrap transition-colors',
            value === o.value ? 'bg-fg font-medium text-canvas' : 'text-muted hover:text-fg')}>
          {o.label}
        </button>
      ))}
    </div>
  )
}
