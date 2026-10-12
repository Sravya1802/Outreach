import { cn } from '@/lib/cn'

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn('inline-block shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70', className)}
      style={{ width: size, height: size }}
    />
  )
}

export function PageSpinner() {
  return (
    <div className="flex flex-1 items-center justify-center py-24 text-subtle">
      <Spinner size={20} />
    </div>
  )
}
