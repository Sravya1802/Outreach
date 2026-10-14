import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api, type EvaluationSummary } from '@/lib/api'
import { Button, Dialog, Field, Input, Textarea, useToast } from '@/ui'

/** Note + dated next step for one pipeline row. Mount it per row (key on id) so the form starts fresh. */
export function NotesDialog({ row, onClose, onSaved }: { row: EvaluationSummary; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [notes, setNotes] = useState(row.notes ?? '')
  const [nextStep, setNextStep] = useState(row.next_step ?? '')
  const [nextStepAt, setNextStepAt] = useState(row.next_step_at ?? '')

  const save = useMutation({
    mutationFn: () => api.savePipelineNotes(row.id, { notes, next_step: nextStep, next_step_at: nextStepAt }),
    onSuccess: () => { toast.success('Saved'); onSaved(); onClose() },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Dialog open onClose={save.isPending ? () => {} : onClose} label={`Notes for ${row.company_name}`} className="max-w-lg">
      <form onSubmit={e => { e.preventDefault(); save.mutate() }}>
        <div className="space-y-4 p-5">
          <div>
            <h2 className="text-[15px] font-semibold text-fg">{row.company_name}</h2>
            <p className="text-[13px] text-muted">{row.job_title}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px]">
            <Field label="Next step">
              {p => <Input {...p} data-autofocus value={nextStep} maxLength={200} placeholder="Phone screen, send thank-you…" onChange={e => setNextStep(e.target.value)} />}
            </Field>
            <Field label="On">
              {p => <Input {...p} type="date" value={nextStepAt} onChange={e => setNextStepAt(e.target.value)} />}
            </Field>
          </div>
          <Field label="Notes" hint="Recruiter names, interview rounds, anything you want to remember.">
            {p => <Textarea {...p} value={notes} maxLength={5000} rows={6} onChange={e => setNotes(e.target.value)} />}
          </Field>
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <Button type="button" onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button type="submit" variant="primary" loading={save.isPending}>Save</Button>
        </div>
      </form>
    </Dialog>
  )
}
