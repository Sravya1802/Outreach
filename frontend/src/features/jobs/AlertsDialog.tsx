import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellRing, Mail } from 'lucide-react'
import { qk } from '@/app/queryClient'
import { api, type AlertSubscription, type RoleType } from '@/lib/api'
import { Button, Dialog, ErrorState, Field, Input, Select, Spinner, useToast } from '@/ui'

/**
 * "Email me new roles" — the job-alert subscription, opened from the Roles
 * page and pre-filled with the search the user is looking at.
 */
export function AlertsDialog({ onClose, roleType, search }: { onClose: () => void; roleType: RoleType; search: string }) {
  const toast = useToast()
  const qc = useQueryClient()
  const current = useQuery({ queryKey: qk.alerts, queryFn: api.alertSubscription })

  const save = useMutation({
    mutationFn: api.saveAlertSubscription,
    onSuccess: (sub) => {
      qc.setQueryData(qk.alerts, (old: Awaited<ReturnType<typeof api.alertSubscription>> | undefined) => old ? { ...old, subscription: sub } : old)
      toast.success(sub.subscribed ? `Alerts on — ${sub.frequency} emails to ${sub.email}` : 'Alerts turned off')
      onClose()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const test = useMutation({
    mutationFn: api.sendTestAlert,
    onSuccess: (r) => toast.success(`Test sent to ${r.to} (${r.total} roles in the window)`),
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Dialog open onClose={onClose} label="Email alerts" className="max-w-lg">
      <div className="flex items-center gap-2.5 border-b border-line px-5 py-4">
        <BellRing className="size-4 text-accent" />
        <h2 className="text-[15px] font-semibold">Email me new roles</h2>
      </div>
      {current.isLoading ? (
        <div className="flex justify-center py-10 text-subtle"><Spinner /></div>
      ) : !current.data ? (
        <ErrorState error={current.error} onRetry={() => void current.refetch()} />
      ) : (
        <AlertsForm
          initial={current.data.subscription}
          emailConfigured={current.data.emailConfigured}
          suggested={{ roleType, keywords: search }}
          saving={save.isPending}
          testing={test.isPending}
          onSave={(sub) => save.mutate(sub)}
          onTest={() => test.mutate()}
          onCancel={onClose}
        />
      )}
    </Dialog>
  )
}

function AlertsForm({ initial, emailConfigured, suggested, saving, testing, onSave, onTest, onCancel }: {
  initial: AlertSubscription
  emailConfigured: boolean
  suggested: { roleType: RoleType; keywords: string }
  saving: boolean
  testing: boolean
  onSave: (s: Partial<AlertSubscription>) => void
  onTest: () => void
  onCancel: () => void
}) {
  // New subscriptions start from the search on screen; existing ones keep their settings.
  const [roleType, setRoleType] = useState<AlertSubscription['roleType']>(initial.subscribed ? initial.roleType : suggested.roleType)
  const [keywords, setKeywords] = useState(initial.subscribed ? initial.keywords : suggested.keywords)
  const [frequency, setFrequency] = useState<AlertSubscription['frequency']>(initial.frequency)

  return (
    <>
      <div className="space-y-4 p-5">
        <p className="flex items-center gap-2 text-[13px] text-muted">
          <Mail className="size-3.5 shrink-0" /> Sent to <span className="text-fg">{initial.email}</span>
        </p>
        {!emailConfigured && (
          <p role="status" className="rounded-md bg-warning-soft px-3 py-2 text-xs text-warning">
            Email sending isn't set up on the server yet, so alerts will be saved but not delivered until it is.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Roles">
            {p => (
              <Select {...p} value={roleType} onChange={e => setRoleType(e.target.value as AlertSubscription['roleType'])}>
                <option value="all">Internships and new grad</option>
                <option value="intern">Internships</option>
                <option value="new_grad">New grad</option>
              </Select>
            )}
          </Field>
          <Field label="How often">
            {p => (
              <Select {...p} value={frequency} onChange={e => setFrequency(e.target.value as AlertSubscription['frequency'])}>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly (Mondays)</option>
              </Select>
            )}
          </Field>
        </div>
        <Field label="Keywords" hint="Optional. Matches role titles and company names, e.g. “machine learning, backend”.">
          {p => <Input {...p} value={keywords} onChange={e => setKeywords(e.target.value)} placeholder="Any role" maxLength={300} />}
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3">
        <div className="flex gap-2">
          {initial.subscribed && (
            <Button variant="danger" size="sm" disabled={saving} onClick={() => onSave({ subscribed: false, roleType, keywords, frequency })}>Turn off</Button>
          )}
          {emailConfigured && initial.subscribed && <Button size="sm" variant="ghost" loading={testing} onClick={onTest}>Send test</Button>}
        </div>
        <div className="flex gap-2">
          <Button onClick={onCancel} disabled={saving}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={() => onSave({ subscribed: true, roleType, keywords: keywords.trim(), frequency })}>
            {initial.subscribed ? 'Save' : 'Turn on alerts'}
          </Button>
        </div>
      </div>
    </>
  )
}
