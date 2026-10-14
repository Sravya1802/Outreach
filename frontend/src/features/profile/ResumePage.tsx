import { useRef, useState, type DragEvent } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { Cloud, Download, FileText, Upload } from 'lucide-react'
import { api, type ResumeHistory } from '@/lib/api'
import type { Market } from '@/lib/markets'
import { qk } from '@/app/queryClient'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Badge, Button, EmptyState, ErrorState, Page, PageHeader, Select, Skeleton, useToast } from '@/ui'
import { KIND_LABEL, countryLabel, countryOf, formatBytes } from './resumeFiles'

const MAX_BYTES = 10 * 1024 * 1024

export default function ResumePage() {
  const qc = useQueryClient()
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const status = useQuery({ queryKey: qk.resume, queryFn: api.resumeStatus })
  const history = useQuery({ queryKey: qk.resumeHistory, queryFn: api.resumeHistory })

  const upload = useMutation({
    mutationFn: api.uploadResume,
    onSuccess: () => {
      toast.success('Resume saved to the cloud')
      void qc.invalidateQueries({ queryKey: qk.resume })
      void qc.invalidateQueries({ queryKey: qk.hasResume })
      void qc.invalidateQueries({ queryKey: qk.resumeHistory })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const download = useMutation({
    mutationFn: (f: { id: number; filename: string }) => api.downloadResumeFile(f.id, f.filename),
    onError: (e: Error) => toast.error(e.message),
  })
  const get = (f: { id: number; filename: string }) => download.mutate({ id: f.id, filename: f.filename })

  function pick(file: File | undefined) {
    if (!file) return
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) { toast.error('Upload a PDF'); return }
    if (file.size > MAX_BYTES) { toast.error('That PDF is over 10 MB'); return }
    upload.mutate(file)
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    pick(e.dataTransfer.files?.[0])
  }

  const r = status.data
  const earlier = (history.data?.masters ?? []).filter(m => !m.is_current)

  return (
    <Page>
      <PageHeader
        title="Your master resume"
        description="Every evaluation reads it, and every tailored resume starts from it. Bullets get reworded and reordered per job; nothing that isn’t in this file is ever added."
      />

      {status.error ? <ErrorState error={status.error} onRetry={() => status.refetch()} /> : status.isLoading ? <Skeleton className="h-40" /> : (
        <div className="space-y-6">
          {r?.hasResume && (
            <section className="flex flex-wrap items-center gap-4 rounded-[4px] border border-line bg-surface p-5">
              <span className="grid h-14 w-11 shrink-0 place-items-center rounded-[3px] border border-line-strong bg-raised font-mono text-[10px] text-subtle" aria-hidden="true">PDF</span>
              <div className="min-w-0 flex-1 basis-[220px]">
                <p className="truncate font-medium text-fg">{r.file?.filename || r.name || 'resume.pdf'}</p>
                <p className="flex flex-wrap items-center gap-x-2 text-[13px] text-muted">
                  <span>Uploaded {timeAgo(r.file?.created_at || r.date)}</span>
                  {r.file && <span>· {formatBytes(r.file.size_bytes)}</span>}
                  {r.inCloud
                    ? <span className="inline-flex items-center gap-1 text-success"><Cloud className="size-3.5" aria-hidden="true" /> Saved in the cloud</span>
                    : <span className="text-warning">Not in the cloud yet. Upload it again to keep a copy.</span>}
                </p>
              </div>
              <div className="flex gap-2 max-sm:w-full max-sm:justify-end">
                {r.file && <Button variant="ghost" icon={<Download className="size-4" />} onClick={() => r.file && get(r.file)}>Download</Button>}
                <Button onClick={() => input.current?.click()} loading={upload.isPending} icon={<Upload className="size-4" />}>Replace</Button>
              </div>
            </section>
          )}

          <label
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn('flex cursor-pointer flex-col items-center gap-2 rounded-[4px] border border-dashed px-6 py-10 text-center transition-colors',
              dragging ? 'border-accent bg-accent-soft' : 'border-line-strong hover:bg-hover')}>
            <FileText className="size-6 text-subtle" aria-hidden="true" />
            <span className="font-medium text-fg">{r?.hasResume ? 'Drop a new PDF to replace it' : 'Drop your resume PDF here'}</span>
            <span className="text-[13px] text-muted">or click to choose a file · PDF only · up to 10 MB · older versions are kept</span>
            <input ref={input} type="file" accept="application/pdf,.pdf" className="sr-only" onChange={e => { pick(e.target.files?.[0]); e.target.value = '' }} />
          </label>

          <UsedFor history={history} onDownload={get} />

          {earlier.length > 0 && (
            <section aria-labelledby="earlier-h">
              <h2 id="earlier-h" className="mb-2 font-display text-[20px] font-semibold text-fg">Earlier versions</h2>
              <ul className="border-t border-rule">
                {earlier.map(m => (
                  <li key={m.id} className="flex items-center gap-3 border-b border-line py-2.5 text-[14px]">
                    <span className="min-w-0 flex-1 truncate text-fg">{m.filename}</span>
                    <span className="text-[13px] text-subtle">{timeAgo(m.created_at)} · {formatBytes(m.size_bytes)}</span>
                    <Button size="sm" variant="ghost" aria-label={`Download ${m.filename}`} icon={<Download className="size-3.5" />} onClick={() => get(m)} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {r?.textPreview && (
            <section aria-labelledby="read-h">
              <h2 id="read-h" className="mb-2 font-display text-[20px] font-semibold text-fg">What we read from it</h2>
              <p className="rounded-[4px] border border-line bg-surface p-4 font-mono text-[12px] leading-relaxed whitespace-pre-line text-muted">{r.textPreview}…</p>
              <p className="mt-2 text-[13px] text-subtle">If this looks garbled, your PDF may be an image. Export it again from Word, Google Docs or LaTeX so the text can be selected.</p>
            </section>
          )}
        </div>
      )}
    </Page>
  )
}

type CountryFilter = Market | 'all'

/** Every application with the exact resume that went (or will go) with it. */
function UsedFor({ history, onDownload }: {
  history: UseQueryResult<ResumeHistory>
  onDownload: (f: { id: number; filename: string }) => void
}) {
  const [country, setCountry] = useState<CountryFilter>('all')
  const all = history.data?.applications ?? []
  const counts = all.reduce<Record<Market, number>>((acc, a) => { acc[countryOf(a)] += 1; return acc }, { usa: 0, india: 0, other: 0 })
  const rows = country === 'all' ? all : all.filter(a => countryOf(a) === country)

  return (
    <section aria-labelledby="used-h">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="used-h" className="font-display text-[20px] font-semibold text-fg">Which resume went where</h2>
          <p className="text-[13px] text-muted">Every application keeps the exact PDF it was sent with, stored in the cloud.</p>
        </div>
        {all.length > 0 && (
          <Select value={country} onChange={e => setCountry(e.target.value as CountryFilter)} aria-label="Country" className="w-48">
            <option value="all">All countries · {all.length}</option>
            {(['usa', 'india', 'other'] as const).filter(m => counts[m] > 0).map(m => (
              <option key={m} value={m}>{countryLabel(m)} · {counts[m]}</option>
            ))}
          </Select>
        )}
      </div>

      {history.error ? <ErrorState error={history.error} onRetry={() => history.refetch()} /> : history.isLoading ? <Skeleton className="h-24" /> : rows.length === 0 ? (
        <div className="border-t border-rule">
          <EmptyState title="No applications with a resume yet"
            description="When a resume is tailored for a role or sent with an application, it shows up here with the role and country." />
        </div>
      ) : (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse border-t border-rule text-[14px]">
            <thead>
              <tr className="text-left text-[13px] text-subtle">
                <th className="py-3 pr-3 font-medium">Company and role</th>
                <th className="px-3 py-3 font-medium">Where</th>
                <th className="px-3 py-3 font-medium">Resume</th>
                <th className="py-3 pl-3"><span className="sr-only">Download</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(a => (
                <tr key={`${a.evaluation_id}-${a.id}`} className="border-t border-line align-top">
                  <td className="py-3 pr-3">
                    <Link to={`/applications/evaluate?id=${a.evaluation_id}`} className="hover:text-accent">
                      <b className="font-medium text-fg">{a.company_name}</b> <span className="text-muted">· {a.job_title}</span>
                    </Link>
                  </td>
                  <td className="px-3 py-3 text-[13px] text-muted">
                    <span className="text-fg">{countryLabel(countryOf(a))}</span>{a.location ? ` · ${a.location}` : ''}
                  </td>
                  <td className="px-3 py-3">
                    <p className="truncate text-[13px] text-fg" title={a.filename}>{a.filename}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-subtle">
                      {KIND_LABEL[a.kind]}
                      {a.sent ? <Badge tone="success">Sent {a.applied_at ? timeAgo(a.applied_at) : ''}</Badge> : <Badge tone="neutral">Ready to send</Badge>}
                    </p>
                  </td>
                  <td className="py-3 pl-3 text-right">
                    <Button size="sm" variant="ghost" aria-label={`Download the resume for ${a.company_name}`} icon={<Download className="size-3.5" />} onClick={() => onDownload(a)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
