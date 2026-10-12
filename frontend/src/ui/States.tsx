import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from './Button'

export function EmptyState({ icon, title, description, action }: {
  icon?: ReactNode
  title: string
  description?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      {icon && <div className="mb-3 text-subtle [&>svg]:size-5">{icon}</div>}
      <p className="text-[13px] font-medium text-fg">{title}</p>
      {description && <p className="mt-1 max-w-sm text-xs text-subtle">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry, compact = false }: { error: unknown; onRetry?: () => void; compact?: boolean }) {
  const message = error instanceof Error ? error.message : 'Something went wrong.'
  return (
    <div role="alert" className={compact ? 'flex items-center gap-2 px-4 py-3 text-xs text-danger' : 'flex flex-col items-center px-6 py-10 text-center'}>
      <AlertTriangle className={compact ? 'size-3.5 shrink-0' : 'mb-3 size-5 text-danger'} />
      <p className={compact ? 'min-w-0 flex-1 truncate' : 'text-[13px] font-medium text-fg'}>
        {compact ? message : 'Couldn’t load this'}
      </p>
      {!compact && <p className="mt-1 max-w-md text-xs text-subtle">{message}</p>}
      {onRetry && (
        <Button size="sm" variant={compact ? 'ghost' : 'secondary'} className={compact ? '' : 'mt-4'} onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  )
}
