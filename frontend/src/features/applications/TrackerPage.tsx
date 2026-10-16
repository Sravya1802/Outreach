import { useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, ExternalLink, Plus, Trash2, Upload } from 'lucide-react'
import { api, type TrackerReferral, type TrackerRow, type TrackerStatus } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Button, ConfirmDialog, EmptyState, ErrorState, Input, Page, PageHeader, Segmented, Skeleton, useToast } from '@/ui'
import {
  FILTERS, PILL, REFERRAL_OPTIONS, STATUS_OPTIONS, linkLabel, matchesFilter, matchesQuery, referralTone, statusTone, trackerCounts, type TrackerFilter,
} from './trackerSheet'

const MAX_CSV_BYTES = 3 * 1024 * 1024

/** Applications → Tracker: every application as a sheet you can keep an eye on. */
export default function TrackerPage() {
  const qc = useQueryClient()
  const toast = useToast()
  const file = useRef<HTMLInputElement>(null)
  const [filter, setFilter] = useState<TrackerFilter>('all')
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<TrackerRow | null>(null)
  const rows = useQuery({ queryKey: qk.tracker, queryFn: api.trackerRows, refetchInterval: 120_000 })
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.tracker })
    void qc.invalidateQueries({ queryKey: qk.pipeline })
  }

  const update = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Parameters<typeof api.trackerUpdate>[1] }) => api.trackerUpdate(id, body),
    onSuccess: (row) => {
      qc.setQueryData<TrackerRow[]>(qk.tracker, old => old?.map(r => (r.id === row.id ? row : r)))
      void qc.invalidateQueries({ queryKey: qk.pipeline })
    },
    onError: (e: Error) => { toast.error(e.message); refresh() },
  })
  const imported = useMutation({
    mutationFn: api.trackerImport,
    onSuccess: (r) => {
      toast.success(`Imported ${r.total} rows: ${r.added} added, ${r.updated} updated${r.unchanged ? `, ${r.unchanged} already up to date` : ''}${r.skipped.length ? `, ${r.skipped.length} skipped` : ''}.`)
      refresh()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const download = useMutation({ mutationFn: api.trackerDownload, onError: (e: Error) => toast.error(e.message) })
  const remove = useMutation({
    mutationFn: (id: number) => api.deleteEvaluation(id),
    onSuccess: () => { setRemoving(null); refresh() },
    onError: (e: Error) => { toast.error(e.message); setRemoving(null) },
  })

  async function pick(f: File | undefined) {
    if (!f) return
    if (!/\.csv$/i.test(f.name)) { toast.error('Choose a .csv file (in Google Sheets: File → Download → CSV)'); return }
    if (f.size > MAX_CSV_BYTES) { toast.error('That file is too large'); return }
    imported.mutate(await f.text())
  }

  const all = rows.data ?? []
  const shown = all.filter(r => matchesFilter(r, filter) && matchesQuery(r, q))
  const c = trackerCounts(all)

  return (
    <Page wide>
      <PageHeader
        title="Tracker"
        description="Every application in one sheet. Change a status as you hear back; roles the app applies to for you show up here on their own."
      />
      {rows.error ? <ErrorState error={rows.error} onRetry={() => void rows.refetch()} /> : rows.isLoading ? <Skeleton className="h-72" /> : (
        <div className="space-y-5">
          <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-[4px] border border-line bg-line sm:grid-cols-6">
            {[
              ['Applied', c.applied], ['Waiting', c.waiting], ['In progress', c.active], ['Offers', c.offers], ['Rejected', c.rejected], ['Referred', c.referred],
            ].map(([label, n]) => (
              <div key={label} className="bg-surface px-4 py-3">
                <dt className="text-[12px] text-muted">{label}</dt>
                <dd className="mt-0.5 font-mono text-[22px] text-fg">{n}</dd>
              </div>
            ))}
          </dl>

          <div className="flex flex-wrap items-center gap-2">
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search company or role" aria-label="Search company or role" className="w-full sm:w-64" />
            <div className="max-w-full overflow-x-auto"><Segmented value={filter} onChange={setFilter} options={FILTERS} label="Show" /></div>
            <div className="ml-auto flex flex-wrap gap-2">
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Add a row</Button>
              <Button variant="ghost" icon={<Upload className="size-4" />} loading={imported.isPending} onClick={() => file.current?.click()}>Import CSV</Button>
              <Button variant="ghost" icon={<Download className="size-4" />} loading={download.isPending} onClick={() => download.mutate()}>Download CSV</Button>
              <input ref={file} type="file" accept=".csv,text/csv" className="sr-only" onChange={e => { void pick(e.target.files?.[0]); e.target.value = '' }} />
            </div>
          </div>

          {adding && <AddRow onDone={() => { setAdding(false); refresh() }} onCancel={() => setAdding(false)} />}

          {all.length === 0 ? (
            <EmptyState title="No applications yet" description="Import your spreadsheet (File → Download → CSV in Google Sheets), or add a row. Roles you approve from the evening list appear here on their own." />
          ) : (
            <div className="overflow-x-auto rounded-[4px] border border-line">
              <table className="w-full min-w-[1040px] border-collapse text-left text-[14px]">
                <thead className="bg-raised text-[12px] tracking-wide text-subtle uppercase">
                  <tr>
                    <th className="px-3 py-2 font-normal">Company</th>
                    <th className="px-3 py-2 font-normal">Role</th>
                    <th className="px-3 py-2 font-normal">Link</th>
                    <th className="px-3 py-2 font-normal">Submitted</th>
                    <th className="px-3 py-2 font-normal">Application status</th>
                    <th className="px-3 py-2 font-normal">Referral</th>
                    <th className="px-3 py-2 font-normal">Updated</th>
                    <th className="w-10 px-2 py-2"><span className="sr-only">Remove</span></th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map(r => (
                    <tr key={r.id} className="border-t border-line align-middle">
                      <td className="px-1 py-1"><CellText value={r.company_name} label={`Company for ${r.job_title}`} onSave={v => update.mutate({ id: r.id, body: { company: v } })} /></td>
                      <td className="px-1 py-1"><CellText value={r.job_title} label={`Role at ${r.company_name}`} wide onSave={v => update.mutate({ id: r.id, body: { role: v } })} /></td>
                      <td className="px-3 py-1 whitespace-nowrap">
                        <CellLink row={r} onSave={v => update.mutate({ id: r.id, body: { link: v } })} />
                      </td>
                      <td className="px-3 py-1">
                        <Pill
                          label={`Submitted for ${r.company_name}`}
                          tone={r.submitted ? 'success' : 'none'}
                          value={r.submitted ? 'yes' : 'no'}
                          options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]}
                          onChange={v => update.mutate({ id: r.id, body: { submitted: v === 'yes' } })}
                        />
                      </td>
                      <td className="px-3 py-1">
                        <Pill
                          label={`Application status for ${r.company_name}`}
                          tone={statusTone(r.apply_status)}
                          value={r.apply_status}
                          options={STATUS_OPTIONS}
                          onChange={v => update.mutate({ id: r.id, body: { status: v as TrackerStatus } })}
                        />
                      </td>
                      <td className="px-3 py-1">
                        <Pill
                          label={`Referral for ${r.company_name}`}
                          tone={referralTone(r.referral)}
                          value={r.referral ?? ''}
                          options={REFERRAL_OPTIONS}
                          onChange={v => update.mutate({ id: r.id, body: { referral: (v || null) as TrackerReferral | null } })}
                        />
                      </td>
                      <td className="px-3 py-1 text-[13px] whitespace-nowrap text-subtle">
                        {timeAgo(r.updated_at)}{r.by_app && <span className="ml-1.5 rounded bg-accent-soft px-1.5 py-0.5 text-[11px] text-accent">by the app</span>}
                      </td>
                      <td className="px-2 py-1">
                        <Button size="sm" variant="ghost" aria-label={`Remove ${r.company_name} · ${r.job_title}`} icon={<Trash2 className="size-3.5" />} onClick={() => setRemoving(r)} />
                      </td>
                    </tr>
                  ))}
                  {shown.length === 0 && (
                    <tr><td colSpan={8} className="px-3 py-6 text-center text-[14px] text-muted">Nothing matches. Clear the search or pick another filter.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[13px] text-subtle">
            {all.length} applications · {c.notApplied} not applied yet. To bring your sheet in: in Google Sheets, File → Download → Comma-separated values (.csv), then Import CSV here. Rows already here are updated, not doubled.
          </p>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(removing)}
        title="Remove this application?"
        description={removing ? `${removing.company_name} · ${removing.job_title} comes off the tracker and the dashboard.` : ''}
        confirmLabel="Remove"
        danger
        busy={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
        onCancel={() => setRemoving(null)}
      />
    </Page>
  )
}

/** A dropdown that looks like the sheet's colored chips. */
function Pill({ value, options, tone, label, onChange }: { value: string; options: { value: string; label: string }[]; tone: keyof typeof PILL; label: string; onChange: (v: string) => void }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={e => onChange(e.target.value)}
      className={cn('h-7 max-w-[13rem] cursor-pointer appearance-none rounded-full border-0 px-3 pr-6 text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-accent', PILL[tone])}
      style={{ backgroundImage: 'linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%)', backgroundPosition: 'calc(100% - 12px) 50%, calc(100% - 8px) 50%', backgroundSize: '4px 4px', backgroundRepeat: 'no-repeat' }}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

/** Text that wraps like a sheet cell; click it to edit, and it saves when you leave the cell or press Enter. */
function CellText({ value, label, wide, onSave }: { value: string; label: string; wide?: boolean; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const width = wide ? 'min-w-[16rem]' : 'min-w-[8rem] max-w-[12rem]'
  if (!editing) {
    return (
      <button type="button" aria-label={`Edit ${label}`} onClick={() => { setDraft(value); setEditing(true) }}
        className={cn('block w-full rounded-[3px] border border-transparent px-2 py-1.5 text-left leading-snug text-fg hover:border-line', width)}>
        {value}
      </button>
    )
  }
  const commit = () => { setEditing(false); const v = draft.trim(); if (v && v !== value) onSave(v) }
  return (
    <textarea
      autoFocus
      aria-label={label}
      value={draft}
      rows={2}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } if (e.key === 'Escape') { setDraft(value); setEditing(false) } }}
      className={cn('block w-full resize-none rounded-[3px] border border-accent bg-transparent px-2 py-1.5 leading-snug text-fg focus:outline-none', width)}
    />
  )
}

function CellLink({ row, onSave }: { row: TrackerRow; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(row.job_url ?? '')
  if (editing) {
    return (
      <input
        autoFocus
        aria-label={`Link for ${row.company_name}`}
        value={draft}
        placeholder="https://"
        onChange={e => setDraft(e.target.value)}
        onBlur={() => { setEditing(false); if (draft.trim() !== (row.job_url ?? '')) onSave(draft.trim()) }}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setDraft(row.job_url ?? ''); setEditing(false) } }}
        className="h-8 w-56 rounded-[3px] border border-accent bg-transparent px-2 text-fg focus:outline-none"
      />
    )
  }
  return row.job_url ? (
    <span className="inline-flex items-center gap-1.5">
      <a href={row.job_url} target="_blank" rel="noreferrer" className="inline-flex max-w-[11rem] items-center gap-1 truncate text-accent hover:underline">
        <span className="truncate">{linkLabel(row.job_url)}</span><ExternalLink className="size-3 shrink-0" aria-hidden="true" />
      </a>
      <button type="button" onClick={() => setEditing(true)} className="text-[12px] text-subtle hover:text-fg">Edit</button>
    </span>
  ) : (
    <button type="button" onClick={() => setEditing(true)} className="text-[13px] text-subtle hover:text-fg">Add link</button>
  )
}

function AddRow({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const toast = useToast()
  const [company, setCompany] = useState('')
  const [role, setRole] = useState('')
  const [link, setLink] = useState('')
  const [status, setStatus] = useState<TrackerStatus>('submitted')
  const add = useMutation({
    mutationFn: () => api.trackerAdd({ company, role, link: link || undefined, status }),
    onSuccess: () => { toast.success('Added'); onDone() },
    onError: (e: Error) => toast.error(e.message),
  })
  const submit = (e: FormEvent) => { e.preventDefault(); add.mutate() }
  return (
    <form onSubmit={submit} className="grid gap-2 rounded-[4px] border border-line bg-surface p-4 sm:grid-cols-[1fr_1.5fr_1.5fr_auto_auto]">
      <Input aria-label="Company" placeholder="Company" value={company} onChange={e => setCompany(e.target.value)} required autoFocus />
      <Input aria-label="Role" placeholder="Role" value={role} onChange={e => setRole(e.target.value)} required />
      <Input aria-label="Link" placeholder="Link (optional)" value={link} onChange={e => setLink(e.target.value)} inputMode="url" />
      <Pill label="Application status" tone={statusTone(status)} value={status} options={STATUS_OPTIONS} onChange={v => setStatus(v as TrackerStatus)} />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" loading={add.isPending}>Add</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}
