import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileCode, Upload } from 'lucide-react'
import { api } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { timeAgo } from '@/lib/format'
import { Badge, Button, Skeleton, Textarea, useToast } from '@/ui'

const MAX_CHARS = 100_000

/**
 * The LaTeX template tailored resumes are built in. A user can paste or
 * upload their own .tex; its preamble (packages, margins, fonts, section
 * styling) is kept exactly and the content is filled in per job.
 */
export function ResumeTemplate() {
  const qc = useQueryClient()
  const toast = useToast()
  const file = useRef<HTMLInputElement>(null)
  const [tex, setTex] = useState('')
  const [open, setOpen] = useState(false)
  const t = useQuery({ queryKey: qk.resumeTemplate, queryFn: api.resumeTemplate })
  const done = (msg: string) => { toast.success(msg); setTex(''); setOpen(false); void qc.invalidateQueries({ queryKey: qk.resumeTemplate }) }
  const save = useMutation({ mutationFn: () => api.saveResumeTemplate(tex), onSuccess: () => done('Template saved. New tailored resumes use it.'), onError: (e: Error) => toast.error(e.message) })
  const reset = useMutation({ mutationFn: api.resetResumeTemplate, onSuccess: () => done('Back to the default template'), onError: (e: Error) => toast.error(e.message) })

  async function pick(f: File | undefined) {
    if (!f) return
    if (!f.name.toLowerCase().endsWith('.tex')) { toast.error('Choose a .tex file'); return }
    const text = await f.text()
    if (text.length > MAX_CHARS) { toast.error('That file is too large for a resume template'); return }
    setTex(text)
    setOpen(true)
  }

  return (
    <section aria-labelledby="template-h" className="rounded-[4px] border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-[260px]">
          <h2 id="template-h" className="font-display text-[20px] font-semibold text-fg">Resume template</h2>
          <p className="mt-1 text-[14px] leading-relaxed text-muted">
            The LaTeX layout every tailored resume is built in. Paste your own .tex and its packages, margins, fonts and section styling are kept exactly; only the content changes per job.
          </p>
        </div>
        {t.data && (t.data.custom
          ? <Badge tone="success">Your template{t.data.updatedAt ? ` · saved ${timeAgo(t.data.updatedAt)}` : ''}</Badge>
          : <Badge>Default template</Badge>)}
      </div>

      {t.isLoading ? <Skeleton className="mt-4 h-10" /> : (
        <div className="mt-4 space-y-3">
          {open ? (
            <form className="space-y-3" onSubmit={e => { e.preventDefault(); save.mutate() }}>
              <label htmlFor="template-tex" className="block text-[13px] text-muted">Your .tex file, from \documentclass down (the body is ignored; only the preamble is kept)</label>
              <Textarea id="template-tex" value={tex} onChange={e => setTex(e.target.value)} rows={10} spellCheck={false} className="font-mono text-[12px]" placeholder={'\\documentclass[10pt, letterpaper]{article}\n\\usepackage[...]{geometry}\n…'} />
              <div className="flex flex-wrap gap-2">
                <Button type="submit" variant="primary" loading={save.isPending} disabled={!tex.trim()}>Test and save</Button>
                <Button type="button" variant="ghost" onClick={() => { setOpen(false); setTex('') }}>Cancel</Button>
              </div>
              <p className="text-[13px] text-subtle">It’s test-built with your resume on the server first. Commands that read or write files aren’t allowed.</p>
            </form>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button icon={<FileCode className="size-4" />} onClick={() => setOpen(true)}>Paste a template</Button>
              <Button variant="ghost" icon={<Upload className="size-4" />} onClick={() => file.current?.click()}>Upload .tex</Button>
              {t.data?.custom && <Button variant="ghost" loading={reset.isPending} onClick={() => reset.mutate()}>Use the default</Button>}
              <input ref={file} type="file" accept=".tex,text/x-tex,text/plain" className="sr-only" onChange={e => { void pick(e.target.files?.[0]); e.target.value = '' }} />
            </div>
          )}
          {t.data && (
            <details>
              <summary className="cursor-pointer text-[14px] text-accent">See the preamble in use</summary>
              <pre className="mt-2 max-h-72 overflow-auto rounded-[3px] border border-line bg-raised p-3 font-mono text-[12px] leading-relaxed text-muted">{t.data.preamble}</pre>
            </details>
          )}
        </div>
      )}
    </section>
  )
}
