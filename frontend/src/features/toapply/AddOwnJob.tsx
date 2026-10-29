import { useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Upload } from 'lucide-react'
import { api } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { Button, Card, Field, Input, Textarea, useToast } from '@/ui'

/**
 * A job you found yourself: its link, the company and your resume. It goes the
 * way an approved evening-list role goes: people found there, a referral asked
 * for (emails wait for your OK in the Outbox), then the app applies in the
 * company's morning. No PDF: the app writes the tailored resume first.
 */
export function AddOwnJob() {
  const qc = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()
  const file = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [company, setCompany] = useState('')
  const [title, setTitle] = useState('')
  const [jd, setJd] = useState('')
  const [needJd, setNeedJd] = useState(false)
  const [resume, setResume] = useState<File | null>(null)

  const add = useMutation({
    mutationFn: () => api.addOwnJob({ url: url.trim(), company: company.trim(), title: title.trim(), jobDescription: jd.trim(), resume }),
    onSuccess: (r) => {
      toast.success(r.ownResume
        ? `${company.trim() || 'The job'} is on. Next: people there and a referral ask, then the app applies with your resume.`
        : `${company.trim() || 'The job'} is on. The app is writing your tailored resume first.`)
      setOpen(false); setUrl(''); setCompany(''); setTitle(''); setJd(''); setNeedJd(false); setResume(null)
      void qc.invalidateQueries({ queryKey: qk.resumeJobs })
      navigate(`/resumes/job/${r.evaluationId}`)
    },
    onError: (e: Error) => {
      if (/paste the job description/i.test(e.message)) setNeedJd(true)
      toast.error(e.message)
    },
  })
  const submit = (e: FormEvent) => { e.preventDefault(); if (url.trim()) add.mutate() }
  const pick = (f: File | undefined) => {
    if (!f) return
    if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) { toast.error('Upload a PDF'); return }
    setResume(f)
  }

  if (!open) {
    return <Button icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>Add a job you found</Button>
  }
  return (
    <Card className="p-4">
      <h2 className="font-medium text-fg">Add a job you found</h2>
      <p className="mt-1 text-[13px] text-muted">
        The app finds people there, asks for a referral (your emails wait for your OK in People → Outbox), then applies for you in the company’s morning. Add your resume to send it as it is; leave it out and the app writes a tailored one first.
      </p>
      <form onSubmit={submit} className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Job link">{p => <Input {...p} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" required />}</Field>
        <Field label="Company" hint="Optional for CareerPuck links">{p => <Input {...p} value={company} onChange={e => setCompany(e.target.value)} placeholder="Domino Data Lab" />}</Field>
        <Field label="Role title" hint="Optional: read from the posting">{p => <Input {...p} value={title} onChange={e => setTitle(e.target.value)} placeholder="Forward Deployed Engineer" />}</Field>
        <Field label="Your resume (PDF)" hint={resume ? resume.name : 'Optional'}>
          {p => <div>
            <input id={p.id} ref={file} type="file" accept="application/pdf,.pdf" className="hidden" onChange={e => pick(e.target.files?.[0])} />
            <Button type="button" variant="ghost" icon={<Upload className="size-4" />} onClick={() => file.current?.click()}>{resume ? 'Change' : 'Choose PDF'}</Button>
          </div>}
        </Field>
        {needJd && (
          <div className="sm:col-span-2">
            <Field label="Job description" hint="The link couldn’t be read; paste the posting’s text.">{p => <Textarea {...p} rows={6} value={jd} onChange={e => setJd(e.target.value)} />}</Field>
          </div>
        )}
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" variant="primary" loading={add.isPending} disabled={!url.trim()}>Apply for me</Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      </form>
    </Card>
  )
}
