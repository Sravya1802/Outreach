import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api, type OutboxItem } from '@/lib/api'
import { Button, Dialog, Field, Input, Textarea, useToast } from '@/ui'
import { STEP_LABEL } from './outbox'

/** Edit an email that hasn't gone out (a draft's Gmail copy is replaced too). */
export function EditEmailDialog({ item, onClose, onSaved }: { item: OutboxItem; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [subject, setSubject] = useState(item.subject)
  const [body, setBody] = useState(item.body)
  const save = useMutation({
    mutationFn: () => api.editOutbox(item.id, { subject, body }),
    onSuccess: () => { toast.success('Saved'); onSaved() },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Dialog open onClose={onClose} label="Edit email" className="max-w-xl">
      <div className="space-y-3 p-5">
        <h3 className="font-display text-[20px] font-semibold text-fg">{item.status === 'draft' ? 'Edit draft' : `Edit ${STEP_LABEL[item.step].toLowerCase()}`}</h3>
        {item.status === 'draft' && item.in_gmail_drafts && <p className="text-[13px] text-muted">Saving replaces the copy in your Gmail Drafts.</p>}
        <Field label="Subject">{f => <Input {...f} value={subject} onChange={e => setSubject(e.target.value)} />}</Field>
        <Field label="Message">{f => <Textarea {...f} rows={10} value={body} onChange={e => setBody(e.target.value)} />}</Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
        </div>
      </div>
    </Dialog>
  )
}
