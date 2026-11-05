import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { api, type OutreachTemplates, type TemplateVariant } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { cn } from '@/lib/cn'
import { Button, ConfirmDialog, ErrorState, Field, Input, Page, PageHeader, Skeleton, Textarea, useToast } from '@/ui'

const KINDS = [
  { kind: 'email', title: 'Cold email', hint: 'The style the AI follows for first emails. Keep it short; it rewrites the details per person.' },
  { kind: 'linkedin', title: 'LinkedIn message', hint: 'Connection notes have a 300-character limit, so keep this one brief.' },
] as const

const LINKEDIN_LIMIT = 300

/** What the Claude chat runs follow. Each save is a new config version, read by the next run. */
function RunRules() {
  const qc = useQueryClient()
  const toast = useToast()
  const q = useQuery({ queryKey: qk.runConfig, queryFn: api.runConfig })
  const [email, setEmail] = useState<string | null>(null)
  const [rules, setRules] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: () => api.saveRunConfig({ email_template: email ?? undefined, linkedin_rules: rules ?? undefined }),
    onSuccess: c => { qc.setQueryData(qk.runConfig, c); setEmail(null); setRules(null); toast.success('Saved. The next run follows these.') },
    onError: (e: Error) => toast.error(e.message),
  })
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  if (q.isLoading) return <Skeleton className="h-40" />
  const c = q.data
  if (!c) return null
  const dirty = (email != null && email !== c.email_template) || (rules != null && rules !== c.linkedin_rules)
  return (
    <section aria-labelledby="run-h" className="space-y-4 border-t border-rule pt-5">
      <div>
        <h2 id="run-h" className="font-display text-[22px] font-semibold text-fg">What your Claude runs follow</h2>
        <p className="mt-1 text-[14px] text-muted">The formal referral email and the LinkedIn rules every run reads. Emails a run has already written stay as they are; edit those by hand.</p>
      </div>
      <Field label="Formal email template">{f => <Textarea {...f} rows={12} value={email ?? c.email_template ?? ''} onChange={e => setEmail(e.target.value)} className="font-mono text-[13px]" />}</Field>
      <Field label="LinkedIn rules">{f => <Textarea {...f} rows={5} value={rules ?? c.linkedin_rules ?? ''} onChange={e => setRules(e.target.value)} className="font-mono text-[13px]" />}</Field>
      <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty}>Save for the next run</Button>
    </section>
  )
}

const newId = () => `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

export default function TemplatesPage() {
  const qc = useQueryClient()
  const toast = useToast()
  const q = useQuery({ queryKey: qk.templates, queryFn: api.templates })
  const [draft, setDraft] = useState<OutreachTemplates | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const t = draft ?? q.data?.templates
  const dirty = draft != null && JSON.stringify(draft) !== JSON.stringify(q.data?.templates)
  const overLimit = (t?.linkedin.length ?? 0) > LINKEDIN_LIMIT

  const edit = (patch: Partial<OutreachTemplates>) => t && setDraft({ ...t, ...patch })
  const editVariant = (id: string, patch: Partial<TemplateVariant>) => t && edit({ variants: t.variants.map(v => (v.id === id ? { ...v, ...patch } : v)) })

  const save = useMutation({
    mutationFn: () => api.saveTemplates(draft as OutreachTemplates),
    onSuccess: () => {
      // Show what was saved right away (the refetch below confirms it), so the
      // pre-save copy never flashes back.
      const saved = draft
      if (saved) qc.setQueryData(qk.templates, (old: { defaults: { email: string; linkedin: string } } | undefined) => ({ defaults: old?.defaults ?? { email: '', linkedin: '' }, templates: { ...saved, variants: saved.variants.filter(v => v.body.trim()) } }))
      setDraft(null)
      toast.success('Templates saved')
      void qc.invalidateQueries({ queryKey: qk.templates })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Page>
      <PageHeader
        title="Email templates"
        description="The tone and shape the AI follows when it writes to someone. It always rewrites the specifics for each person and company."
        actions={<Button variant="primary" onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty || overLimit}>Save</Button>}
      />

      {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !t ? <Skeleton className="h-72" /> : (
        <div className="space-y-12">
          <RunRules />
          {KINDS.map(k => {
            const variants = t.variants.filter(v => v.kind === k.kind)
            return (
              <section key={k.kind} aria-labelledby={`${k.kind}-h`} className="border-t border-rule pt-5">
                <h2 id={`${k.kind}-h`} className="font-display text-[22px] font-semibold text-fg">{k.title}</h2>
                <p className="mt-1 mb-4 text-[14px] text-muted">{k.hint} Placeholders like {'{{first_name}}'} and {'{{company}}'} work.</p>
                <Field label="Main template">
                  {f => <Textarea {...f} rows={9} value={t[k.kind]} onChange={e => edit({ [k.kind]: e.target.value })} className="font-mono text-[13px]" />}
                </Field>
                {k.kind === 'linkedin' && <p className={cn('mt-1 text-[12px]', overLimit ? 'text-danger' : 'text-subtle')}>{t.linkedin.length}/{LINKEDIN_LIMIT}{overLimit && `, ${t.linkedin.length - LINKEDIN_LIMIT} over the limit`}</p>}

                <div className="mt-6 space-y-4">
                  {variants.map(v => (
                    <div key={v.id} className="rounded-[4px] border border-line bg-surface p-4">
                      <div className="mb-3 flex gap-2">
                        <Input value={v.name} onChange={e => editVariant(v.id, { name: e.target.value })} aria-label="Variant name"
                          placeholder={k.kind === 'email' ? 'e.g. Recruiter after applying' : 'e.g. Short connect note'} />
                        <Button variant="ghost" aria-label={`Delete ${v.name || 'variant'}`} icon={<Trash2 className="size-4" />}
                          onClick={() => edit({ variants: t.variants.filter(x => x.id !== v.id) })} />
                      </div>
                      <Textarea rows={6} value={v.body} onChange={e => editVariant(v.id, { body: e.target.value })} aria-label={`${v.name || 'Variant'} text`} className="font-mono text-[13px]" />
                      {!v.body.trim() && <p className="mt-1 text-[12px] text-warning">A variant without text isn’t saved.</p>}
                    </div>
                  ))}
                  <Button size="sm" icon={<Plus className="size-4" />}
                    onClick={() => edit({ variants: [...t.variants, { id: newId(), kind: k.kind, name: '', body: '' }] })}>
                    Add a variant
                  </Button>
                </div>
              </section>
            )
          })}

          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
            <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty || overLimit}>Save</Button>
            {dirty && <Button variant="ghost" onClick={() => setDraft(null)}>Discard changes</Button>}
            <Button variant="ghost" className="ml-auto" onClick={() => setConfirmReset(true)}>Reset to defaults</Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmReset}
        title="Reset to the default templates?"
        description="Your main templates go back to the defaults and your variants are removed. Nothing changes until you press Save."
        confirmLabel="Reset"
        onConfirm={() => { if (q.data) setDraft({ ...q.data.defaults, variants: [] }); setConfirmReset(false) }}
        onCancel={() => setConfirmReset(false)}
      />
    </Page>
  )
}
