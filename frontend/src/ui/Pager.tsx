import { ChevronLeft, ChevronRight } from 'lucide-react'
import { formatNumber } from '@/lib/format'
import { Button } from './Button'
import { Select } from './Field'

/** "51–100 of 1,234" with previous/next, and "Show 50 per page" when `onPageSize` is given. `page` is zero-based. */
export function Pager({ page, pageSize, total, onPage, busy = false, sizes = [50, 100, 200], onPageSize }: {
  page: number
  pageSize: number
  total: number
  onPage: (p: number) => void
  busy?: boolean
  sizes?: readonly number[]
  onPageSize?: (n: number) => void
}) {
  const smallest = onPageSize ? Math.min(...sizes) : pageSize
  if (total <= smallest && page === 0) return null
  const from = total === 0 ? 0 : page * pageSize + 1
  const to = Math.min(total, (page + 1) * pageSize)
  const last = Math.max(0, Math.ceil(total / pageSize) - 1)
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs text-subtle">
      <span className="tabular-nums">{formatNumber(from)}–{formatNumber(to)} of {formatNumber(total)}</span>
      <div className="flex flex-wrap items-center gap-3">
        {onPageSize && (
          <label className="flex items-center gap-1.5">
            Show
            <Select value={pageSize} onChange={e => onPageSize(Number(e.target.value))} aria-label="Rows per page" className="h-8 w-auto! text-xs">
              {sizes.map(n => <option key={n} value={n}>{n}</option>)}
            </Select>
            per page
          </label>
        )}
        {last > 0 && <span className="tabular-nums">Page {formatNumber(page + 1)} of {formatNumber(last + 1)}</span>}
        <div className="flex gap-1.5">
          <Button size="sm" variant="ghost" icon={<ChevronLeft className="size-3.5" />} disabled={page <= 0 || busy} onClick={() => onPage(page - 1)} aria-label="Previous page">Prev</Button>
          <Button size="sm" variant="ghost" disabled={page >= last || busy} onClick={() => onPage(page + 1)} aria-label="Next page">
            Next <ChevronRight className="size-3.5" />
          </Button>
        </div>
      </div>
    </nav>
  )
}
