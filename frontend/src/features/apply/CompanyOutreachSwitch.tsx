import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useToast } from '@/ui'

/** "No outreach for this company": on, nobody there gets an email or note, and what's unsent is closed. */
export function CompanyOutreachSwitch({ company, onDone }: { company: string; onDone?: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const key = ['review', 'company-outreach', company.trim().toLowerCase()]
  const q = useQuery({ queryKey: key, queryFn: () => api.companyOutreach(company), enabled: Boolean(company.trim()) })
  // What you just set shows at once, before the server answers; back to the server's value if it refuses.
  const [mine, setMine] = useState<boolean | null>(null)
  const set = useMutation({
    mutationFn: (on: boolean) => api.setCompanyOutreach(company, on),
    // The switch moves at once; it goes back if the server says no.
    onMutate: (on: boolean) => {
      const before = qc.getQueryData<{ company: string; noOutreach: boolean }>(key)
      qc.setQueryData(key, { company, noOutreach: on })
      return { before }
    },
    onSuccess: r => {
      qc.setQueryData(key, { company: r.company, noOutreach: r.noOutreach })
      const closed = (r.closed ?? 0) + (r.cancelled ?? 0)
      toast.success(r.noOutreach ? `No outreach for ${company}.${closed ? ` Closed ${closed} unsent email${closed === 1 ? '' : 's'}${r.notes ? ` and ${r.notes} note${r.notes === 1 ? '' : 's'}` : ''}.` : ''}` : `Outreach for ${company} is back on.`)
      void qc.invalidateQueries({ queryKey: ['review'] })
      onDone?.()
    },
    onError: (e: Error, _on, ctx) => { setMine(null); if (ctx?.before) qc.setQueryData(key, ctx.before); toast.error(e.message) },
    onSettled: () => setMine(null),
  })
  const on = mine ?? Boolean(q.data?.noOutreach)
  return (
    <label className="inline-flex items-center gap-2 text-[13px] text-fg">
      <input type="checkbox" role="switch" aria-checked={on} className="size-4 accent-accent" checked={on} disabled={!q.data}
        onChange={e => { setMine(e.target.checked); set.mutate(e.target.checked) }} />
      No outreach for this company
      {on && <span className="text-subtle">· nobody at {company} gets an email or note</span>}
    </label>
  )
}
