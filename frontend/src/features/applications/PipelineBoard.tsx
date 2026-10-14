import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BellRing, CalendarClock, NotebookPen } from 'lucide-react'
import type { EvaluationSummary, PipelineColumn } from '@/lib/api'
import { cn } from '@/lib/cn'
import { Select } from '@/ui'
import { STAGES, scoreOutOf10, scoreTone, stageFor } from './score'
import { followUpDays, nextStepDue, type DueState } from './pipeline'

const TONE_TEXT = { strong: 'text-success', ok: 'text-warning', weak: 'text-danger', none: 'text-subtle' } as const
const DUE_TEXT: Record<DueState, string> = { overdue: 'text-danger', today: 'text-warning', soon: 'text-fg', later: 'text-muted' }
const DRAG_TYPE = 'application/x-outreach-eval'

function Card({ r, now, choices, onMove, onEdit }: {
  r: EvaluationSummary
  now: number
  choices: PipelineColumn[]
  onMove: (id: number, column: PipelineColumn) => void
  onEdit: (r: EvaluationSummary) => void
}) {
  const s = scoreOutOf10(r.score)
  const quiet = followUpDays(r, now)
  const due = nextStepDue(r.next_step_at)
  return (
    <li draggable onDragStart={e => { e.dataTransfer.setData(DRAG_TYPE, String(r.id)); e.dataTransfer.effectAllowed = 'move' }}
      className="cursor-grab rounded-[4px] border border-line bg-surface p-3 text-[13px] active:cursor-grabbing">
      <div className="flex items-start justify-between gap-2">
        <Link to={`/applications/evaluate?id=${r.id}`} className="min-w-0 hover:text-accent">
          <p className="truncate text-[14px] font-medium text-fg">{r.company_name}</p>
          <p className="line-clamp-2 text-muted">{r.job_title}</p>
        </Link>
        <span className={cn('shrink-0 font-mono text-[14px]', TONE_TEXT[scoreTone(s)])}>{s ?? '—'}</span>
      </div>
      {quiet != null && <p className="mt-2 flex items-center gap-1.5 text-warning"><BellRing className="size-3.5 shrink-0" aria-hidden="true" />No reply in {quiet} days</p>}
      {(r.next_step || due) && (
        <p className={cn('mt-2 flex items-center gap-1.5', due ? DUE_TEXT[due.state] : 'text-muted')}>
          <CalendarClock className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{r.next_step || 'Next step'}{due && <> · {due.label}</>}</span>
        </p>
      )}
      <div className="mt-3 flex items-center gap-1.5">
        <Select value="" aria-label={`Move ${r.company_name} to another stage`} className="h-7 flex-1 text-[12px]"
          onChange={e => { if (e.target.value) onMove(r.id, e.target.value as PipelineColumn) }}>
          <option value="" disabled>Move to…</option>
          {STAGES.filter(st => choices.includes(st.id) && st.id !== stageFor(r.apply_status)).map(st => <option key={st.id} value={st.id}>{st.label}</option>)}
        </Select>
        <button type="button" onClick={() => onEdit(r)} aria-label={`Notes and next step for ${r.company_name}`} title="Notes and next step"
          className={cn('grid size-7 shrink-0 place-items-center rounded-[4px] hover:bg-hover', r.notes || r.next_step || r.next_step_at ? 'text-accent' : 'text-subtle hover:text-fg')}>
          <NotebookPen className="size-3.5" />
        </button>
      </div>
    </li>
  )
}

/** Stages as columns; drag a card (or use its menu) to change stage. */
export function PipelineBoard({ items, columns, choices, now, onMove, onEdit }: {
  items: EvaluationSummary[]
  columns: PipelineColumn[]
  /** Stages a card can be moved to. */
  choices: PipelineColumn[]
  now: number
  onMove: (id: number, column: PipelineColumn) => void
  onEdit: (r: EvaluationSummary) => void
}) {
  const [over, setOver] = useState<PipelineColumn | null>(null)
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0">
      <div className="flex gap-3">
        {STAGES.filter(st => columns.includes(st.id)).map(st => {
          const cards = items.filter(r => stageFor(r.apply_status) === st.id)
          return (
            <section key={st.id} aria-label={st.label}
              onDragOver={e => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); setOver(st.id) } }}
              onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null) }}
              onDrop={e => {
                e.preventDefault(); setOver(null)
                // Postgres bigint ids arrive as strings, so compare as text.
                const id = e.dataTransfer.getData(DRAG_TYPE)
                const card = items.find(r => String(r.id) === id)
                if (card && stageFor(card.apply_status) !== st.id) onMove(card.id, st.id)
              }}
              className={cn('flex min-w-44 flex-1 basis-0 flex-col rounded-[6px] border p-2 transition-colors',
                over === st.id ? 'border-accent bg-accent-soft' : 'border-line bg-hover/40')}>
              <h3 className="flex items-baseline justify-between px-1 pt-1 pb-2 text-[13px] font-medium text-fg">
                {st.label}<span className="font-mono text-[12px] font-normal text-subtle">{cards.length}</span>
              </h3>
              <ul className="flex min-h-24 flex-col gap-2">
                {cards.map(r => <Card key={r.id} r={r} now={now} choices={choices} onMove={onMove} onEdit={onEdit} />)}
                {cards.length === 0 && <li className="px-1 py-6 text-center text-[12px] text-subtle">Drop a role here</li>}
              </ul>
            </section>
          )
        })}
      </div>
    </div>
  )
}
