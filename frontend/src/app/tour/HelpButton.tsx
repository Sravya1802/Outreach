import { CircleHelp } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useTour } from './context'

/** Replays the tour. Sits at the right of the top bar and the phone header. */
export function HelpButton({ showLabel = false }: { showLabel?: boolean }) {
  const { start } = useTour()
  return (
    <button type="button" onClick={start} data-tour="help" aria-label="Help: tour of the app"
      className={cn('flex h-8 items-center gap-1.5 rounded-[4px] text-[13px] text-muted transition-colors hover:bg-hover hover:text-fg',
        showLabel ? 'px-2.5' : 'w-8 justify-center')}>
      <CircleHelp className="size-4" aria-hidden="true" />
      {showLabel && <span className="hidden xl:inline">Help</span>}
    </button>
  )
}
