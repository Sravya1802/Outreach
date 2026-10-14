import { ChevronLeft, ChevronRight } from 'lucide-react'
import { formatNumber } from '@/lib/format'
import { Button } from './Button'

/** "51–100 of 1,234" with previous/next. `page` is zero-based. */
export function Pager({ page, pageSize, total, onPage, busy = false }: {
  page: number
  pageSize: number
  total: number
  onPage: (p: number) => void
  busy?: boolean
}) {
  if (total <= pageSize && page === 0) return null
  const from = total === 0 ? 0 : page * pageSize + 1
  const to = Math.min(total, (page + 1) * pageSize)
  const last = Math.max(0, Math.ceil(total / pageSize) - 1)
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 px-4 py-3 text-xs text-subtle">
      <span className="tabular-nums">{formatNumber(from)}–{formatNumber(to)} of {formatNumber(total)}</span>
      <div className="flex gap-1.5">
        <Button size="sm" variant="ghost" icon={<ChevronLeft className="size-3.5" />} disabled={page <= 0 || busy} onClick={() => onPage(page - 1)} aria-label="Previous page">Prev</Button>
        <Button size="sm" variant="ghost" disabled={page >= last || busy} onClick={() => onPage(page + 1)} aria-label="Next page">
          Next <ChevronRight className="size-3.5" />
        </Button>
      </div>
    </nav>
  )
}
