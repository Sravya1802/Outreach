import { cn } from '@/lib/cn'

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('rounded bg-hover', className)}
      style={{
        backgroundImage: 'linear-gradient(90deg, transparent, var(--ui-raised), transparent)',
        backgroundSize: '400px 100%',
        backgroundRepeat: 'no-repeat',
        animation: 'ui-shimmer 1.4s ease-in-out infinite',
      }}
    />
  )
}
