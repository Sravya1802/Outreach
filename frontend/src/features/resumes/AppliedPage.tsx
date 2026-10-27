import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Download, Eye } from 'lucide-react'
import { api, type ResumeFileUse } from '@/lib/api'
import type { Market } from '@/lib/markets'
import { qk } from '@/app/queryClient'
import { Button, EmptyState, ErrorState, Input, Page, PageHeader, Segmented, Select, Skeleton, useToast } from '@/ui'
import { KIND_LABEL, countryLabel, countryOf } from '@/features/profile/resumeFiles'
import { PdfDialog } from '@/features/profile/PdfViewer'
import { ManualApply } from '@/features/applications/ManualApply'
import { isApplied, matchesApplied, type AppliedFilter } from '@/features/applications/applied'

type CountryFilter = Market | 'all'

/** Resumes → Applied: every application and the exact resume that went with it, and the ones still to apply to. */
export default function AppliedPage() {
  const toast = useToast()
  const history = useQuery({ queryKey: qk.resumeHistory, queryFn: api.resumeHistory })
  const [filter, setFilter] = useState<AppliedFilter>('applied')
  const [country, setCountry] = useState<CountryFilter>('all')
  const [q, setQ] = useState('')
  const [viewing, setViewing] = useState<{ id: number; filename: string } | null>(null)
  const download = useMutation({
    mutationFn: (f: { id: number; filename: string }) => api.downloadResumeFile(f.id, f.filename),
    onError: (e: Error) => toast.error(e.message),
  })

  const all = history.data?.applications ?? []
  const applied = all.filter(isApplied).length
  const s = q.trim().toLowerCase()
  const counts = all.reduce<Record<Market, number>>((acc, a) => { acc[countryOf(a)] += 1; return acc }, { usa: 0, india: 0, other: 0 })
  const rows = all.filter(a => matchesApplied(a, filter)
    && (country === 'all' || countryOf(a) === country)
    && (!s || a.company_name.toLowerCase().includes(s) || a.job_title.toLowerCase().includes(s)))
  const options = [
    { value: 'applied' as const, label: `Applied · ${applied}` },
    { value: 'ready' as const, label: `Ready to apply · ${all.length - applied}` },
    { value: 'all' as const, label: 'All' },
  ]

  return (
    <Page wide>
      <PageHeader title="Applied"
        description="Every role you’ve applied to, with the exact resume that went with it. Ready to apply lists the roles whose resume is done but not sent: apply on the employer’s site, then press I applied." />
      {history.error ? <ErrorState error={history.error} onRetry={() => void history.refetch()} /> : history.isLoading ? <Skeleton className="h-72" /> : all.length === 0 ? (
        <EmptyState title="Nothing yet" description="When a resume is tailored for a role or sent with an application, it shows up here." />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search company or role" aria-label="Search company or role" className="w-full sm:w-64" />
            <div className="max-w-full overflow-x-auto"><Segmented value={filter} onChange={setFilter} options={options} label="Show" /></div>
            <Select value={country} onChange={e => setCountry(e.target.value as CountryFilter)} aria-label="Country" className="w-44!">
              <option value="all">All countries</option>
              {(['usa', 'india', 'other'] as const).filter(m => counts[m] > 0).map(m => <option key={m} value={m}>{countryLabel(m)} · {counts[m]}</option>)}
            </Select>
          </div>
          <div className="overflow-x-auto rounded-[4px] border border-line bg-surface">
            <table className="w-full min-w-[880px] border-collapse text-[14px]">
              <thead>
                <tr className="border-b border-line bg-raised text-left text-[12px] font-medium tracking-wide text-subtle uppercase">
                  <th className="px-3 py-2 font-medium">Company and role</th>
                  <th className="px-3 py-2 font-medium">Where</th>
                  <th className="px-3 py-2 font-medium">Resume</th>
                  <th className="px-3 py-2 font-medium">Applied</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a: ResumeFileUse) => (
                  <tr key={`${a.evaluation_id}-${a.id}`} className="border-b border-line align-top last:border-0">
                    <td className="px-3 py-3">
                      <Link to={`/jobs/job/${a.evaluation_id}`} className="hover:text-accent">
                        <b className="font-medium text-fg">{a.company_name}</b> <span className="text-muted">· {a.job_title}</span>
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-[13px] text-muted"><span className="text-fg">{countryLabel(countryOf(a))}</span>{a.location ? ` · ${a.location}` : ''}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="max-w-72 truncate text-[13px] text-fg" title={a.filename}>{a.filename}</p>
                          <p className="text-[12px] text-subtle">{KIND_LABEL[a.kind]}{isApplied(a) && !a.sent ? ' · set for this role' : ''}</p>
                        </div>
                        <Button size="sm" variant="ghost" icon={<Eye className="size-3.5" />} aria-label={`View the resume for ${a.company_name}`} onClick={() => setViewing({ id: a.id, filename: a.filename })}>View</Button>
                        <Button size="sm" variant="ghost" icon={<Download className="size-3.5" />} aria-label={`Download the resume for ${a.company_name}`} onClick={() => download.mutate({ id: a.id, filename: a.filename })} />
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <ManualApply evalId={a.evaluation_id} company={a.company_name} jobUrl={a.job_url} applied={isApplied(a)} appliedAt={a.applied_at} applyStatus={a.apply_status} compact />
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-muted">
                  {filter === 'applied' ? 'No applications yet. Roles you apply to, or mark as applied, show up here.' : 'Nothing matches. Clear the search or pick another filter.'}
                </td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <PdfDialog file={viewing} onClose={() => setViewing(null)} />
    </Page>
  )
}
