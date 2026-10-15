import { useState } from 'react'
import { FileText } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { useProfile } from '@/app/queries'
import { cn } from '@/lib/cn'
import { Button, ErrorState, Field, Input, Page, PageHeader, Select, Skeleton, Textarea, useToast } from '@/ui'
import { ExperienceList } from './ExperienceList'
import { readExperiences, type Experience } from './experience'
import { resumeFill } from './resumeFill'
import { IMPORTANT_KEYS, REQUIRED_KEYS, SECTIONS, labelFor, missing, toForm, toPatch, type FieldDef, type FormValues } from './fields'

function Control({ def, value, disabled, onChange, field }: {
  def: FieldDef
  value: string
  disabled: boolean
  onChange: (v: string) => void
  field: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }
}) {
  if (def.kind === 'select') {
    return (
      <Select {...field} value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>
        {def.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </Select>
    )
  }
  if (def.kind === 'textarea') {
    return <Textarea {...field} value={value} disabled={disabled} placeholder={def.placeholder} onChange={e => onChange(e.target.value)} rows={3} />
  }
  return (
    <Input {...field} type={def.kind ?? 'text'} value={value} disabled={disabled} placeholder={def.placeholder}
      autoComplete={def.autoComplete} onChange={e => onChange(e.target.value)} />
  )
}

function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="mt-1 size-4 shrink-0 accent-[var(--ui-accent)]" />
      <span>
        <span className="block text-[14px] font-medium text-fg">{label}</span>
        <span className="block text-[13px] text-muted">{description}</span>
      </span>
    </label>
  )
}

export default function DetailsPage() {
  const { data: profile, isLoading, error, refetch } = useProfile()
  const qc = useQueryClient()
  const toast = useToast()
  // Unsaved edits sit on top of the saved profile, so a refetch never wipes typing.
  const [edits, setEdits] = useState<FormValues>({})
  const saved = toForm(profile)
  const values: FormValues = { ...saved, ...edits }
  const [expEdits, setExpEdits] = useState<Experience[] | null>(null)
  const experiences = expEdits ?? readExperiences(profile?.experiences)
  const dirty = Object.keys(edits).some(k => edits[k] !== saved[k]) || expEdits != null
  const set = (key: string) => (v: string) => setEdits(prev => ({ ...prev, [key]: v }))

  const save = useMutation({
    mutationFn: () => api.saveProfile({ ...toPatch(values), ...(expEdits ? { experiences: expEdits } : {}) }),
    onSuccess: row => {
      qc.setQueryData(qk.profile, row)
      setEdits({})
      setExpEdits(null)
      toast.success('Profile saved')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // Fills empty fields only; the user reviews and saves.
  const fill = useMutation({
    mutationFn: api.parsedResume,
    onSuccess: parsed => {
      const r = resumeFill(parsed, values, experiences)
      if (!r.filled) { toast.success('Nothing to add: everything on your resume is already here.'); return }
      setEdits(prev => ({ ...prev, ...r.edits }))
      if (r.experiences) setExpEdits(r.experiences)
      toast.success(`Filled ${r.filled} ${r.filled === 1 ? 'field' : 'fields'} from your resume. Check them, then Save.`)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const requiredMissing = missing(values, REQUIRED_KEYS)
  const importantDone = IMPORTANT_KEYS.length - missing(values, IMPORTANT_KEYS).length

  if (error) return <Page><ErrorState error={error} onRetry={() => refetch()} /></Page>

  return (
    <Page>
      <PageHeader
        title="Your details"
        description="Filled into every application. Fill it once; auto-apply never guesses these."
        actions={<>
          <Button icon={<FileText className="size-4" />} onClick={() => fill.mutate()} loading={fill.isPending} disabled={isLoading}>Fill from resume</Button>
          <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty || isLoading}>Save</Button>
        </>}
      />

      {isLoading ? (
        <div className="space-y-4">{[0, 1, 2].map(i => <Skeleton key={i} className="h-40" />)}</div>
      ) : (
        <form onSubmit={e => { e.preventDefault(); save.mutate() }} className="space-y-10">
          <p className={cn('rounded-[4px] border px-4 py-3 text-[14px]',
            requiredMissing.length ? 'border-warning/40 bg-warning-soft text-fg' : 'border-line bg-surface text-muted')}>
            {requiredMissing.length
              ? <>Auto-apply can’t submit anything until you add: <b>{requiredMissing.map(labelFor).join(', ')}</b>.</>
              : <><span className="font-mono text-fg">{importantDone}</span> of {IMPORTANT_KEYS.length} commonly asked fields filled.</>}
          </p>

          {SECTIONS.map(section => {
            const gated = section.gatedBy ? values[section.gatedBy] !== '1' : false
            return (
              <section key={section.id} aria-labelledby={`sec-${section.id}`} className="border-t border-rule pt-5">
                <div className="mb-5 max-w-2xl">
                  <h2 id={`sec-${section.id}`} className="font-display text-[22px] font-semibold text-fg">{section.title}</h2>
                  <p className="mt-1 text-[14px] text-muted">{section.description}</p>
                </div>
                {section.gatedBy && (
                  <div className="mb-5">
                    <Toggle checked={!gated} onChange={on => set(section.gatedBy as string)(on ? '1' : '0')}
                      label="Store my answers" description="Off: nothing below is saved, and forms get “decline to answer”." />
                  </div>
                )}
                {section.id === 'experience' && (
                  <div className="mb-6"><ExperienceList value={experiences} onChange={setExpEdits} /></div>
                )}
                <div className={cn('grid gap-x-5 gap-y-4 sm:grid-cols-2', gated && 'opacity-50')}>
                  {section.fields.map(def => (
                    <div key={def.key} className={def.wide ? 'sm:col-span-2' : undefined}>
                      <Field label={def.label} hint={def.hint}>
                        {field => <Control def={def} value={values[def.key] ?? ''} disabled={gated} onChange={set(def.key)} field={field} />}
                      </Field>
                    </div>
                  ))}
                </div>
              </section>
            )
          })}

          <section aria-labelledby="sec-consent" className="border-t border-rule pt-5">
            <h2 id="sec-consent" className="mb-4 font-display text-[22px] font-semibold text-fg">Permission</h2>
            <Toggle checked={values.auto_apply_consent === '1'} onChange={on => set('auto_apply_consent')(on ? '1' : '0')}
              label="Let Scout’n’Jobs submit applications for me"
              description="Only roles on your daily plan, after the plan has been sent to you. You can turn this off at any time." />
          </section>

          <div className="flex items-center gap-3 border-t border-line pt-5">
            <Button type="submit" variant="primary" loading={save.isPending} disabled={!dirty}>Save</Button>
            {dirty && <span className="text-[13px] text-subtle">Unsaved changes</span>}
          </div>
        </form>
      )}
    </Page>
  )
}
