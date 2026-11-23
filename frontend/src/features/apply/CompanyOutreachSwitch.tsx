import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useToast } from '@/ui'

/** "No outreach for this company": on, nobody there gets an email or note, and what's unsent is closed. */
export function CompanyOutreachSwitch({ company, onDone }: { company: string; onDone?: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const key = ['review', 'company-outreach', company.trim().toLowerCase()]
  const q = useQuery({ queryKey: key, queryFn: () => api.companyOutreach(company), enabled: Boolean(company.trim()) })
  const set = useMutation({
    mutationFn: (on: boolean) => api.setCompanyOutreach(company, on),
    onSuccess: r => {
      qc.setQueryData(key, { company: r.company, noOutreach: r.noOutreach })
      const closed = (r.closed ?? 0) + (r.cancelled ?? 0)
      toast.success(r.noOutreach ? `No outreach for ${company}.${closed ? ` Closed ${closed} unsent email${closed === 1 ? '' : 's'}${r.notes ? ` and ${r.notes} note${r.notes === 1 ? '' : 's'}` : ''}.` : ''}` : `Outreach for ${company} is back on.`)
      void qc.invalidateQueries({ queryKey: ['review'] })
      onDone?.()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const on = Boolean(q.data?.noOutreach)
  return (
    <label className="inline-flex items-center gap-2 text-[13px] text-fg">
      <input type="checkbox" role="switch" aria-checked={on} className="size-4 accent-accent" checked={on} disabled={!q.data || set.isPending}
        onChange={e => set.mutate(e.target.checked)} />
      No outreach for this company
      {on && <span className="text-subtle">· nobody at {company} gets an email or note</span>}
    </label>
  )
}
