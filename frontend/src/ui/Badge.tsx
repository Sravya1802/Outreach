import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info'

const tones: Record<Tone, string> = {
  neutral: 'bg-hover text-muted',
  accent: 'bg-accent-soft text-accent',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
}

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex h-5 items-center gap-1 rounded px-1.5 text-[11px] font-medium leading-none whitespace-nowrap', tones[tone], className)}>
      {children}
    </span>
  )
}

const dotTones: Record<Tone, string> = {
  neutral: 'bg-subtle',
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
}

export function StatusDot({ tone, className, label }: { tone: Tone; className?: string; label?: string }) {
  return <span role={label ? 'img' : undefined} aria-label={label} className={cn('inline-block size-2 shrink-0 rounded-full', dotTones[tone], className)} />
}
