import { useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Upload } from 'lucide-react'
import { api } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { timeAgo } from '@/lib/format'
import { Button, Card, CardBody, CardHeader, ErrorState, Page, PageHeader, Skeleton, useToast } from '@/ui'

const EXPORT_URL = 'https://www.linkedin.com/mypreferences/d/download-my-data'

export default function LinkedInPage() {
  const qc = useQueryClient()
  const toast = useToast()
  const file = useRef<HTMLInputElement>(null)
  const summary = useQuery({ queryKey: qk.connections, queryFn: api.connections })
  const upload = useMutation({
    mutationFn: async (f: File) => api.importConnections(await f.text()),
    onSuccess: (s) => {
      toast.success(`Imported ${s.total} connections`)
      qc.setQueryData(qk.connections, s)
      void qc.invalidateQueries({ queryKey: qk.dailyPlan })
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const clear = useMutation({
    mutationFn: api.clearConnections,
    onSuccess: () => { toast.success('Removed'); void qc.invalidateQueries({ queryKey: qk.connections }) },
    onError: (e: Error) => toast.error(e.message),
  })
  const s = summary.data

  return (
    <Page>
      <PageHeader title="LinkedIn" description="Your connections, so roles at companies where you know someone are flagged, and those people are asked for a referral first." />
      <div className="space-y-4">
        <Card>
          <CardHeader title="Your connections" description={s?.total ? `${s.total} imported ${timeAgo(s.imported)}` : 'Not imported yet'} />
          <CardBody className="space-y-5">
            {summary.error ? <ErrorState error={summary.error} onRetry={() => summary.refetch()} /> : summary.isLoading ? <Skeleton className="h-20" /> : (
              <>
                <ol className="space-y-2 text-[14px] leading-relaxed text-muted">
                  <li><b className="font-medium text-fg">1.</b> Open <a href={EXPORT_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">LinkedIn → Get a copy of your data <ExternalLink className="size-3" /></a>.</li>
                  <li><b className="font-medium text-fg">2.</b> Under “Want something in particular?”, tick <b className="font-medium text-fg">Connections</b> and request the archive. If Connections isn’t in that list, choose the first option instead (the larger archive, which includes connections). LinkedIn emails you a link, within 10 minutes for Connections alone and up to a day for the larger archive.</li>
                  <li><b className="font-medium text-fg">3.</b> Unzip it and upload <code className="font-mono text-[13px]">Connections.csv</code> here. Upload it again any time to refresh.</li>
                </ol>
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" icon={<Upload className="size-4" />} loading={upload.isPending} onClick={() => file.current?.click()}>{s?.total ? 'Upload a newer file' : 'Upload Connections.csv'}</Button>
                  {Boolean(s?.total) && <Button variant="ghost" loading={clear.isPending} onClick={() => clear.mutate()}>Remove all</Button>}
                  <input ref={file} type="file" accept=".csv,text/csv" className="sr-only" onChange={e => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = '' }} />
                </div>
                <p className="text-[13px] text-subtle">Only names, companies, positions and profile links are stored, plus emails if your connections share them. Nobody is contacted until you approve a role at their company.</p>
                {(s?.topCompanies.length ?? 0) > 0 && (
                  <div>
                    <p className="mb-2 text-[12px] tracking-wide text-subtle uppercase">Where you know the most people</p>
                    <ul className="flex flex-wrap gap-2">
                      {s?.topCompanies.map(c => <li key={c.company} className="rounded-full border border-line-strong px-3 py-1 text-[13px] text-muted">{c.company} · {c.n}</li>)}
                    </ul>
                  </div>
                )}
              </>
            )}
          </CardBody>
        </Card>
      </div>
    </Page>
  )
}
