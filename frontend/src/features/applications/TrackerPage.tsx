import { useRef, useState, type KeyboardEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Pencil, Trash2, Upload } from 'lucide-react'
import { api, type TrackerReferral, type TrackerRow, type TrackerStatus } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { cn } from '@/lib/cn'
import { Button, ConfirmDialog, ErrorState, Input, Page, Segmented, Skeleton, useToast } from '@/ui'
import {
  FILTERS, PILL, REFERRAL_OPTIONS, STATUS_OPTIONS, matchesFilter, matchesQuery, referralTone, statusTone, trackerCounts, type PillTone, type TrackerFilter,
} from './trackerSheet'

const MAX_CSV_BYTES = 3 * 1024 * 1024

// A plain grid, laid out like the user's spreadsheet: numbered rows, one
// column per field, every cell bordered.
const cell = 'border border-line px-3 py-2 align-middle'
const head = 'border border-line bg-raised px-3 py-2 text-left text-[12px] font-medium tracking-wide text-subtle uppercase'
const rownum = 'border border-line bg-raised px-2 text-center font-mono text-[11px] text-subtle'

/** Applications → Tracker: every application, in a sheet that looks like your own. */
export default function TrackerPage() {
  const qc = useQueryClient()
  const toast = useToast()
  const file = useRef<HTMLInputElement>(null)
  const [filter, setFilter] = useState<TrackerFilter>('all')
  const [q, setQ] = useState('')
  const [removing, setRemoving] = useState<TrackerRow | null>(null)
  const data = useQuery({ queryKey: qk.tracker, queryFn: api.trackerRows, refetchInterval: 120_000 })
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.tracker })
    void qc.invalidateQueries({ queryKey: qk.pipeline })
  }

  const update = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Parameters<typeof api.trackerUpdate>[1] }) => api.trackerUpdate(id, body),
    onSuccess: (row) => {
      qc.setQueryData<{ rows: TrackerRow[]; title: string }>(qk.tracker, old => old && { ...old, rows: old.rows.map(r => (r.id === row.id ? row : r)) })
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
  const retitle = useMutation({ mutationFn: api.trackerTitle, onSuccess: refresh, onError: (e: Error) => toast.error(e.message) })
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

  const all = data.data?.rows ?? []
  const shown = all.filter(r => matchesFilter(r, filter) && matchesQuery(r, q))
  const c = trackerCounts(all)

  return (
    <Page wide>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[34px] leading-tight font-semibold text-fg">Tracker</h1>
          <p className="mt-1 text-[14px] text-muted">
            {all.length
              ? `${c.applied} applied · ${c.waiting} waiting · ${c.active} in progress · ${c.offers} offers · ${c.rejected} rejected · ${c.referred} referred`
              : 'Every application in one sheet. Import yours, or add rows; roles the app applies to show up on their own.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" icon={<Upload className="size-4" />} loading={imported.isPending} onClick={() => file.current?.click()}>Import CSV</Button>
          <Button variant="ghost" icon={<Download className="size-4" />} loading={download.isPending} onClick={() => download.mutate()}>Download CSV</Button>
          <input ref={file} type="file" accept=".csv,text/csv" className="sr-only" onChange={e => { void pick(e.target.files?.[0]); e.target.value = '' }} />
        </div>
      </div>

      {data.error ? <ErrorState error={data.error} onRetry={() => void data.refetch()} /> : data.isLoading ? <Skeleton className="h-72" /> : (
        <>
          {all.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search company or role" aria-label="Search company or role" className="w-full sm:w-64" />
              <div className="max-w-full overflow-x-auto"><Segmented value={filter} onChange={setFilter} options={FILTERS} label="Show" /></div>
            </div>
          )}

          <div className="mb-2"><Banner title={data.data?.title ?? ''} onSave={t => retitle.mutate(t)} /></div>
          <div className="overflow-x-auto rounded-[4px] border border-line bg-surface">
            <table className="w-full min-w-[1100px] table-fixed border-collapse text-[14px] text-fg [&_tr>*:first-child]:border-l-0 [&_tr>*:last-child]:border-r-0 [&_thead_tr:first-child>*]:border-t-0">
              <colgroup>
                {/* Roles takes what's left; the chips get room for their longest words ("Waiting to hear back", "Not Required"). */}
                <col className="w-11" /><col className="w-[12rem]" /><col /><col className="w-[17rem]" /><col className="w-[7rem]" /><col className="w-[13rem]" /><col className="w-[10rem]" /><col className="w-10" />
              </colgroup>
              <thead>
                <tr>
                  <th className={rownum}><span className="sr-only">Row</span>#</th>
                  <th className={head}>Companies</th>
                  <th className={head}>Roles</th>
                  <th className={head}>Link</th>
                  <th className={head}>Submitted</th>
                  <th className={head}>Application Status</th>
                  <th className={head}>Referral Status</th>
                  <th className={cn(head, 'px-1')}><span className="sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={r.id} className="group hover:bg-hover/40">
                    <td className={rownum}>{i + 1}</td>
                    <td className={cell}>
                      <CellText value={r.company_name} label={`Company for ${r.job_title}`} onSave={v => update.mutate({ id: r.id, body: { company: v } })} />
                      {r.by_app && <span className="mt-0.5 inline-block font-sans text-[10px] tracking-wide text-accent uppercase">by the app</span>}
                    </td>
                    <td className={cell}><CellText value={r.job_title} label={`Role at ${r.company_name}`} onSave={v => update.mutate({ id: r.id, body: { role: v } })} /></td>
                    <td className={cell}><CellLink row={r} onSave={v => update.mutate({ id: r.id, body: { link: v } })} /></td>
                    <td className={cell}>
                      <Chip label={`Submitted for ${r.company_name}`} tone={r.submitted ? 'success' : 'none'} value={r.submitted ? 'yes' : 'no'}
                        options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: '—' }]}
                        onChange={v => update.mutate({ id: r.id, body: { submitted: v === 'yes' } })} />
                    </td>
                    <td className={cell}>
                      <Chip label={`Application status for ${r.company_name}`} tone={statusTone(r.apply_status)} value={r.apply_status} options={STATUS_OPTIONS}
                        onChange={v => update.mutate({ id: r.id, body: { status: v as TrackerStatus } })} />
                    </td>
                    <td className={cell}>
                      <Chip label={`Referral for ${r.company_name}`} tone={referralTone(r.referral)} value={r.referral ?? ''} options={REFERRAL_OPTIONS}
                        onChange={v => update.mutate({ id: r.id, body: { referral: (v || null) as TrackerReferral | null } })} />
                    </td>
                    <td className={cn(cell, 'px-1 text-center')}>
                      <button type="button" aria-label={`Remove ${r.company_name} · ${r.job_title}`} onClick={() => setRemoving(r)}
                        className="rounded p-1 text-subtle opacity-0 group-hover:opacity-100 hover:text-danger focus-visible:opacity-100">
                        <Trash2 className="size-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
                <NewRow n={shown.length + 1} onAdded={refresh} />
              </tbody>
            </table>
          </div>
          {all.length === 0 && (
            <p className="mt-4 text-[14px] text-muted">
              To bring your sheet in: in Google Sheets, <span className="text-fg">File → Download → Comma-separated values (.csv)</span>, then <span className="text-fg">Import CSV</span> above. Importing again later updates rows instead of doubling them.
            </p>
          )}
          {all.length > 0 && shown.length === 0 && <p className="mt-3 text-[14px] text-muted">Nothing matches. Clear the search or pick another filter.</p>}
        </>
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

/** A dropdown chip: full cell width, colored by status, with a little arrow. */
function Chip({ value, options, tone, label, onChange }: { value: string; options: { value: string; label: string }[]; tone: PillTone; label: string; onChange: (v: string) => void }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={e => onChange(e.target.value)}
      className={cn('h-7 w-full cursor-pointer appearance-none rounded-full border-0 pr-6 pl-3 text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-accent', PILL[tone])}
      style={{ backgroundImage: 'linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%)', backgroundPosition: 'calc(100% - 13px) 55%, calc(100% - 9px) 55%', backgroundSize: '4px 4px', backgroundRepeat: 'no-repeat' }}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

const blurActive = () => (document.activeElement as HTMLElement | null)?.blur()
const onKeys = (cancel: () => void) => (e: KeyboardEvent<HTMLElement>) => {
  if (e.key === 'Enter') { e.preventDefault(); blurActive() }
  if (e.key === 'Escape') cancel()
}

/** Text that wraps in its cell; click to edit, Enter or leaving the cell saves. */
function CellText({ value, label, onSave }: { value: string; label: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  if (!editing) {
    return (
      <button type="button" aria-label={`Edit ${label}`} onClick={() => { setDraft(value); setEditing(true) }}
        className="-mx-1 w-[calc(100%+0.5rem)] rounded-[3px] px-1 py-0.5 text-left leading-snug hover:bg-hover">
        {value}
      </button>
    )
  }
  const save = () => { setEditing(false); const v = draft.trim(); if (v && v !== value) onSave(v) }
  return (
    <textarea autoFocus aria-label={label} value={draft} rows={2} onChange={e => setDraft(e.target.value)} onBlur={save}
      onKeyDown={onKeys(() => { setDraft(value); setEditing(false) })}
      className="block w-full resize-none rounded-[3px] border border-accent bg-surface px-1 py-0.5 leading-snug focus:outline-none" />
  )
}

/** The link on one line (full address on hover); the pencil edits it. */
function CellLink({ row, onSave }: { row: TrackerRow; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(row.job_url ?? '')
  if (editing) {
    const save = () => { setEditing(false); if (draft.trim() !== (row.job_url ?? '')) onSave(draft.trim()) }
    return (
      <input autoFocus aria-label={`Link for ${row.company_name}`} value={draft} placeholder="https://" onChange={e => setDraft(e.target.value)} onBlur={save}
        onKeyDown={onKeys(() => { setDraft(row.job_url ?? ''); setEditing(false) })}
        className="h-7 w-full rounded-[3px] border border-accent bg-surface px-1 text-[13px] focus:outline-none" />
    )
  }
  return (
    <div className="flex items-center gap-1">
      {row.job_url && <a href={row.job_url} title={row.job_url} target="_blank" rel="noreferrer" className="min-w-0 truncate text-[13px] text-accent hover:underline">{row.job_url.replace(/^https?:\/\/(www\.)?/, '')}</a>}
      <button type="button" aria-label={`${row.job_url ? 'Edit' : 'Add'} the link for ${row.company_name}`} onClick={() => { setDraft(row.job_url ?? ''); setEditing(true) }}
        className="shrink-0 rounded p-0.5 text-subtle opacity-0 group-hover:opacity-100 hover:text-fg focus-visible:opacity-100">
        <Pencil className="size-3" />
      </button>
    </div>
  )
}

/** The sheet's own title ("2027 New Grad Roles Application"); click to rename it. */
function Banner({ title, onSave }: { title: string; onSave: (t: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  if (!editing) {
    return <button type="button" aria-label="Rename the sheet" onClick={() => { setDraft(title); setEditing(true) }} className="rounded-[3px] px-1 text-[15px] font-medium text-fg hover:bg-hover">{title}</button>
  }
  const save = () => { setEditing(false); const t = draft.trim(); if (t && t !== title) onSave(t) }
  return (
    <input autoFocus aria-label="Sheet title" value={draft} onChange={e => setDraft(e.target.value)} onBlur={save}
      onKeyDown={onKeys(() => setEditing(false))}
      className="block w-full max-w-xl rounded-[3px] border border-accent bg-transparent px-1 text-[15px] font-medium focus:outline-none" />
  )
}

/** The empty row at the bottom: type a company and a role, press Enter, and it's added. */
function NewRow({ n, onAdded }: { n: number; onAdded: () => void }) {
  const toast = useToast()
  const [company, setCompany] = useState('')
  const [role, setRole] = useState('')
  const [link, setLink] = useState('')
  const [status, setStatus] = useState<TrackerStatus>('submitted')
  const add = useMutation({
    mutationFn: () => api.trackerAdd({ company: company.trim(), role: role.trim(), link: link.trim() || undefined, status }),
    onSuccess: () => { setCompany(''); setRole(''); setLink(''); setStatus('submitted'); onAdded() },
    onError: (e: Error) => toast.error(e.message),
  })
  const submit = () => { if (company.trim() && role.trim() && !add.isPending) add.mutate() }
  const keys = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') { e.preventDefault(); submit() } }
  const input = 'h-7 w-full rounded-[3px] border border-transparent bg-transparent px-1 text-[14px] placeholder:text-subtle hover:border-line focus:border-accent focus:outline-none'
  return (
    <tr>
      <td className={rownum}>{n}</td>
      <td className={cell}><input aria-label="New row: company" placeholder="+ Company" value={company} onChange={e => setCompany(e.target.value)} onKeyDown={keys} className={input} /></td>
      <td className={cell}><input aria-label="New row: role" placeholder="Role" value={role} onChange={e => setRole(e.target.value)} onKeyDown={keys} className={input} /></td>
      <td className={cell}><input aria-label="New row: link" placeholder="Link" value={link} onChange={e => setLink(e.target.value)} onKeyDown={keys} inputMode="url" className={input} /></td>
      <td className={cell} />
      <td className={cell}>
        {(company || role) && <Chip label="New row: application status" tone={statusTone(status)} value={status} options={STATUS_OPTIONS} onChange={v => setStatus(v as TrackerStatus)} />}
      </td>
      <td className={cell}>
        {company.trim() && role.trim() && (
          <button type="button" onClick={submit} disabled={add.isPending} className="font-sans text-[13px] text-accent hover:underline">{add.isPending ? 'Adding…' : 'Add row ↵'}</button>
        )}
      </td>
      <td className={cell} />
    </tr>
  )
}
