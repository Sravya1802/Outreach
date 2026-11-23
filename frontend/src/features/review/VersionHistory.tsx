import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type VersionEntry } from '@/lib/api'
import { cn } from '@/lib/cn'
import { Badge, Button, Select, Skeleton } from '@/ui'
import { diffCounts, diffLines, scoreLine, versionStamp, type DiffLine } from './versions'

const REASON_TONE: Record<VersionEntry['reason']['kind'], 'accent' | 'info' | 'warning' | 'neutral' | 'success'> = {
  first: 'neutral', comment: 'accent', master: 'info', fix: 'warning', revision: 'neutral',
}

/** Every version of the role, newest first: why it exists, its scores against the one before, and what changed. */
export function VersionHistory({ roleId, current, onPick }: { roleId: string; current: string | null; onPick: (id: string) => void }) {
  const q = useQuery({ queryKey: ['review', 'history', roleId], queryFn: () => api.versionHistory(roleId) })
  const versions = q.data ?? []
  const [compare, setCompare] = useState<{ from: string; to: string } | null>(null)
  if (q.isLoading) return <Skeleton className="mt-4 h-24" />
  if (!versions.length) return null
  return (
    <section aria-label="Version history" className="mt-5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[12px] font-medium tracking-wide text-subtle uppercase">Versions · {versions.length}</h3>
        {versions.length > 1 && <CompareControl versions={versions} onCompare={setCompare} />}
      </div>
      {compare && <CompareView fromId={compare.from} toId={compare.to} versions={versions} onClose={() => setCompare(null)} />}
      <ol className="space-y-2">
        {versions.map(v => (
          <li key={v.id}>
            <button type="button" onClick={() => onPick(v.id)} aria-current={v.id === current ? 'true' : undefined}
              className={cn('w-full rounded-[4px] border px-3 py-2 text-left transition-colors', v.id === current ? 'border-accent bg-accent-soft/40' : 'border-line hover:border-line-strong')}>
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-[14px] font-medium text-fg">{versionStamp(v)}</span>
                <Badge tone={REASON_TONE[v.reason.kind]}>{v.reason.label}</Badge>
                {v.is_final && <Badge tone="success">Final</Badge>}
              </span>
              {v.reason.quote && <span className="mt-1 block text-[13px] text-muted italic">“{v.reason.quote}”</span>}
              <span className="mt-1 block font-mono text-[12px] text-fg">{scoreLine(v)}</span>
              {v.bullets.length > 0 && <ul className="mt-1 list-disc pl-5 text-[13px] leading-relaxed text-muted">{v.bullets.map(b => <li key={b}>{b}</li>)}</ul>}
              {v.edit && <span className="mt-1 block text-[13px] text-warning">Changed in place: {v.edit.text}</span>}
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}

function CompareControl({ versions, onCompare }: { versions: VersionEntry[]; onCompare: (c: { from: string; to: string }) => void }) {
  const [from, setFrom] = useState(versions[1]?.id ?? '')
  const [to, setTo] = useState(versions[0]?.id ?? '')
  const label = (id: string) => `v${versions.find(v => v.id === id)?.version ?? '?'}`
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-[13px]">
      <Select value={from} onChange={e => setFrom(e.target.value)} aria-label="Compare from" className="w-auto! py-0.5">
        {versions.map(v => <option key={v.id} value={v.id}>v{v.version}</option>)}
      </Select>
      <span className="text-subtle">↔</span>
      <Select value={to} onChange={e => setTo(e.target.value)} aria-label="Compare to" className="w-auto! py-0.5">
        {versions.map(v => <option key={v.id} value={v.id}>v{v.version}</option>)}
      </Select>
      <Button size="sm" disabled={from === to} onClick={() => onCompare({ from, to })}>Compare {label(from)} ↔ {label(to)}</Button>
    </span>
  )
}

const LINE: Record<DiffLine['kind'], string> = {
  same: 'text-muted',
  added: 'bg-success-soft text-fg',
  removed: 'bg-danger-soft text-fg line-through decoration-danger/60',
  moved: 'bg-info-soft text-fg',
}

/** Two versions side by side: added in green, removed in red, moved bullets marked. */
function CompareView({ fromId, toId, versions, onClose }: { fromId: string; toId: string; versions: VersionEntry[]; onClose: () => void }) {
  // Older on the left, newer on the right, whichever way they were picked.
  const older = (versions.find(v => v.id === fromId)?.version ?? 0) <= (versions.find(v => v.id === toId)?.version ?? 0)
  const a = older ? fromId : toId
  const b = older ? toId : fromId
  const left = useQuery({ queryKey: ['review', 'version-text', a], queryFn: () => api.versionText(a) })
  const right = useQuery({ queryKey: ['review', 'version-text', b], queryFn: () => api.versionText(b) })
  if (!left.data || !right.data) return <Skeleton className="mb-3 h-40" />
  const d = diffLines(left.data.lines, right.data.lines)
  const n = diffCounts(d)
  return (
    <div className="mb-4 rounded-[4px] border border-line">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2 text-[13px]">
        <span className="text-fg">
          <b className="font-medium">Compare v{left.data.version} ↔ v{right.data.version}</b>
          <span className="text-muted"> · {n.added} added, {n.removed} removed, {n.moved} moved</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="rounded px-1.5 text-[12px] bg-success-soft">added</span>
          <span className="rounded px-1.5 text-[12px] bg-danger-soft">removed</span>
          <span className="rounded px-1.5 text-[12px] bg-info-soft">moved</span>
          <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
        </span>
      </div>
      <div className="grid max-h-[60vh] grid-cols-1 gap-0 overflow-auto sm:grid-cols-2">
        {[{ v: left.data.version, lines: d.left }, { v: right.data.version, lines: d.right }].map(side => (
          <div key={side.v} className="min-w-0 border-line px-3 py-2 sm:border-r last:border-r-0">
            <p className="mb-1 text-[12px] font-medium text-subtle">v{side.v}</p>
            {side.lines.map((l, i) => (
              <p key={i} className={cn('rounded px-1 text-[12.5px] leading-relaxed break-words', l.text.startsWith('## ') && 'mt-2 font-medium text-fg', LINE[l.kind])}>
                {l.kind === 'moved' && <span className="mr-1 text-[11px] font-medium text-info">moved</span>}{l.text.replace(/^## /, '')}
              </p>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
