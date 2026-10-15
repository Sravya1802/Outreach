import { Plus, Trash2 } from 'lucide-react'
import { Button, Field, Input, Select, Textarea } from '@/ui'
import { EXPERIENCE_TYPES, emptyExperience, type Experience } from './experience'

/** Repeatable experience entries; the parent owns the list and saves it with the profile. */
export function ExperienceList({ value, onChange }: { value: Experience[]; onChange: (next: Experience[]) => void }) {
  const update = (i: number, patch: Partial<Experience>) => onChange(value.map((e, j) => (j === i ? { ...e, ...patch } : e)))
  return (
    <div className="space-y-4">
      {value.map((e, i) => (
        <fieldset key={i} className="relative rounded-[4px] border border-line bg-surface p-4">
          <legend className="sr-only">{e.title || e.company || `Experience ${i + 1}`}</legend>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <p className="text-[14px] font-medium text-fg">{[e.title, e.company].filter(Boolean).join(' at ') || `Experience ${i + 1}`}</p>
            <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} aria-label={`Remove ${e.title || e.company || `experience ${i + 1}`}`}
              onClick={() => onChange(value.filter((_, j) => j !== i))} />
          </div>
          <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
            <Field label="Company">{f => <Input {...f} value={e.company} onChange={ev => update(i, { company: ev.target.value })} placeholder="Mercedes-Benz R&D" />}</Field>
            <Field label="Title">{f => <Input {...f} value={e.title} onChange={ev => update(i, { title: ev.target.value })} placeholder="Data Engineering Intern" />}</Field>
            <Field label="Type">
              {f => (
                <Select {...f} value={e.type} onChange={ev => update(i, { type: ev.target.value as Experience['type'] })}>
                  {EXPERIENCE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Location">{f => <Input {...f} value={e.location} onChange={ev => update(i, { location: ev.target.value })} placeholder="Bengaluru, India" />}</Field>
            <Field label="Started">{f => <Input {...f} type="month" value={e.start} onChange={ev => update(i, { start: ev.target.value })} />}</Field>
            <Field label="Ended">
              {f => <Input {...f} type="month" value={e.current ? '' : e.end} disabled={e.current} onChange={ev => update(i, { end: ev.target.value })} />}
            </Field>
            <label className="flex cursor-pointer items-center gap-2 text-[14px] text-muted sm:col-span-2">
              <input type="checkbox" checked={e.current} onChange={ev => update(i, { current: ev.target.checked, end: ev.target.checked ? '' : e.end })}
                className="size-4 accent-[var(--ui-accent)]" />
              I work here now
            </label>
            <div className="sm:col-span-2">
              <Field label="What you did" hint="A few lines or bullets. Forms that ask for a description get this; your resume still comes from your uploaded file.">
                {f => <Textarea {...f} rows={4} value={e.summary} onChange={ev => update(i, { summary: ev.target.value })} />}
              </Field>
            </div>
          </div>
        </fieldset>
      ))}
      <Button icon={<Plus className="size-4" />} onClick={() => onChange([...value, emptyExperience()])}>
        {value.length ? 'Add another experience' : 'Add an experience'}
      </Button>
    </div>
  )
}
