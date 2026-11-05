import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { Button, EmptyState, ErrorState, Field, Input, Page, PageHeader, Skeleton, useToast } from '@/ui'

/** People → My referrers: who you can ask yourself. Roles at these companies skip recruiter emails. */
export default function ReferrersPage() {
  const qc = useQueryClient()
  const toast = useToast()
  const list = useQuery({ queryKey: qk.referrers, queryFn: api.referrers })
  const [company, setCompany] = useState('')
  const [contact, setContact] = useState('')
  const [note, setNote] = useState('')
  const refresh = () => { void qc.invalidateQueries({ queryKey: qk.referrers }); void qc.invalidateQueries({ queryKey: qk.review }) }
  const add = useMutation({
    mutationFn: () => api.addReferrer({ company_name: company, contact_name: contact, note }),
    onSuccess: r => {
      toast.success(r.moved ? `Saved. ${r.moved} ${r.moved === 1 ? 'role' : 'roles'} there moved to My contact.` : 'Saved.')
      setCompany(''); setContact(''); setNote(''); refresh()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const remove = useMutation({ mutationFn: api.removeReferrer, onSuccess: refresh, onError: (e: Error) => toast.error(e.message) })
  const submit = (e: FormEvent) => { e.preventDefault(); add.mutate() }

  return (
    <Page>
      <PageHeader title="My referrers" description="The people you can ask yourself. Roles at these companies skip recruiter emails and show who to ask. You can still change a role’s mode on its page." />
      <div className="space-y-6">
        <form onSubmit={submit} className="rounded-[4px] border border-line bg-surface p-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_2fr]">
            <Field label="Company">{f => <Input {...f} value={company} onChange={e => setCompany(e.target.value)} placeholder="Amazon" required />}</Field>
            <Field label="Who can refer you">{f => <Input {...f} value={contact} onChange={e => setContact(e.target.value)} placeholder="Their name" required />}</Field>
            <Field label="Note (optional)">{f => <Input {...f} value={note} onChange={e => setNote(e.target.value)} placeholder="Friend from UIC, on the Alexa team" />}</Field>
          </div>
          <Button type="submit" variant="primary" className="mt-3" loading={add.isPending}>Add</Button>
        </form>
        {list.error ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : list.isLoading ? <Skeleton className="h-32" /> : !list.data?.length ? (
          <EmptyState title="No referrers yet" description="Add a company and the person there, and its roles stop emailing recruiters." />
        ) : (
          <ul className="border-t border-line">
            {list.data.map(r => (
              <li key={r.id} className="flex items-center gap-3 border-b border-line py-3 text-[14px]">
                <div className="min-w-0 flex-1">
                  <p className="text-fg"><b className="font-medium">{r.company_name}</b> · Ask {r.contact_name}</p>
                  <p className="text-[13px] text-subtle">{[r.note, `${r.roles} ${r.roles === 1 ? 'role' : 'roles'} in your queue`].filter(Boolean).join(' · ')}</p>
                </div>
                <Button size="sm" variant="ghost" aria-label={`Remove ${r.company_name}`} icon={<Trash2 className="size-3.5" />} loading={remove.isPending && remove.variables === r.id} onClick={() => remove.mutate(r.id)} />
              </li>
            ))}
          </ul>
        )}
        {(list.data?.length ?? 0) > 0 && <p className="text-[13px] text-subtle">Removing someone leaves that company’s roles on My contact. Change a role on its page to email recruiters.</p>}
      </div>
    </Page>
  )
}
