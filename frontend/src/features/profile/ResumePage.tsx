import { useRef, useState, type DragEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, Upload } from 'lucide-react'
import { api } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Button, ErrorState, Page, PageHeader, Skeleton, useToast } from '@/ui'

const MAX_BYTES = 10 * 1024 * 1024

export default function ResumePage() {
  const qc = useQueryClient()
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const status = useQuery({ queryKey: qk.resume, queryFn: api.resumeStatus })

  const upload = useMutation({
    mutationFn: api.uploadResume,
    onSuccess: () => {
      toast.success('Resume uploaded')
      void qc.invalidateQueries({ queryKey: qk.resume })
      void qc.invalidateQueries({ queryKey: qk.hasResume })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function pick(file: File | undefined) {
    if (!file) return
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) { toast.error('Upload a PDF'); return }
    if (file.size > MAX_BYTES) { toast.error('That PDF is over 10 MB'); return }
    upload.mutate(file)
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    pick(e.dataTransfer.files?.[0])
  }

  const r = status.data

  return (
    <Page>
      <PageHeader
        title="Your master resume"
        description="Every evaluation reads it, and every tailored resume starts from it. Bullets get reworded and reordered per job; nothing that isn’t in this file is ever added."
      />

      {status.error ? <ErrorState error={status.error} onRetry={() => status.refetch()} /> : status.isLoading ? <Skeleton className="h-40" /> : (
        <div className="space-y-6">
          {r?.hasResume && (
            <section className="flex flex-wrap items-center gap-4 rounded-[4px] border border-line bg-surface p-5">
              <span className="grid h-14 w-11 shrink-0 place-items-center rounded-[3px] border border-line-strong bg-raised font-mono text-[10px] text-subtle" aria-hidden="true">PDF</span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-fg">{r.name || 'resume.pdf'}</p>
                <p className="text-[13px] text-muted">Uploaded {timeAgo(r.date)}</p>
              </div>
              <Button onClick={() => input.current?.click()} loading={upload.isPending} icon={<Upload className="size-4" />}>Replace</Button>
            </section>
          )}

          <label
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn('flex cursor-pointer flex-col items-center gap-2 rounded-[4px] border border-dashed px-6 py-10 text-center transition-colors',
              dragging ? 'border-accent bg-accent-soft' : 'border-line-strong hover:bg-hover')}>
            <FileText className="size-6 text-subtle" aria-hidden="true" />
            <span className="font-medium text-fg">{r?.hasResume ? 'Drop a new PDF to replace it' : 'Drop your resume PDF here'}</span>
            <span className="text-[13px] text-muted">or click to choose a file · PDF only · up to 10 MB</span>
            <input ref={input} type="file" accept="application/pdf,.pdf" className="sr-only" onChange={e => { pick(e.target.files?.[0]); e.target.value = '' }} />
          </label>

          {r?.textPreview && (
            <section aria-labelledby="read-h">
              <h2 id="read-h" className="mb-2 font-display text-[20px] font-semibold text-fg">What we read from it</h2>
              <p className="rounded-[4px] border border-line bg-surface p-4 font-mono text-[12px] leading-relaxed whitespace-pre-line text-muted">{r.textPreview}…</p>
              <p className="mt-2 text-[13px] text-subtle">If this looks garbled, your PDF may be an image. Export it again from Word, Google Docs or LaTeX so the text can be selected.</p>
            </section>
          )}
        </div>
      )}
    </Page>
  )
}
