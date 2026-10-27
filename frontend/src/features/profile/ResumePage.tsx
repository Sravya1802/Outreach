import { useRef, useState, type DragEvent } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Cloud, Download, Eye, FileText, Trash2, Upload } from 'lucide-react'
import { api, type ResumeFile } from '@/lib/api'
import { qk } from '@/app/queryClient'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Button, ConfirmDialog, ErrorState, Page, PageHeader, Skeleton, useToast } from '@/ui'
import { formatBytes } from './resumeFiles'
import { ResumeTemplate } from './ResumeTemplate'
import { PdfDialog } from './PdfViewer'

const MAX_BYTES = 10 * 1024 * 1024

export default function ResumePage() {
  const qc = useQueryClient()
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const status = useQuery({ queryKey: qk.resume, queryFn: api.resumeStatus })
  const history = useQuery({ queryKey: qk.resumeHistory, queryFn: api.resumeHistory })

  const upload = useMutation({
    mutationFn: api.uploadResume,
    onSuccess: () => {
      toast.success('Resume saved to the cloud')
      void qc.invalidateQueries({ queryKey: qk.resume })
      void qc.invalidateQueries({ queryKey: qk.hasResume })
      void qc.invalidateQueries({ queryKey: qk.resumeHistory })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const download = useMutation({
    mutationFn: (f: { id: number; filename: string }) => api.downloadResumeFile(f.id, f.filename),
    onError: (e: Error) => toast.error(e.message),
  })
  const get = (f: { id: number; filename: string }) => download.mutate({ id: f.id, filename: f.filename })
  // Read a PDF right here, on any device (iPad Safari blocks the download).
  const [viewing, setViewing] = useState<{ id: number; filename: string } | null>(null)
  const view = (f: { id: number; filename: string }) => setViewing({ id: f.id, filename: f.filename })

  const [confirmDelete, setConfirmDelete] = useState<ResumeFile | null>(null)
  const remove = useMutation({
    mutationFn: (id: number) => api.deleteResumeFile(id),
    onSuccess: () => {
      toast.success('Version deleted')
      setConfirmDelete(null)
      void qc.invalidateQueries({ queryKey: qk.resumeHistory })
    },
    onError: (e: Error) => { toast.error(e.message); setConfirmDelete(null) },
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
  const earlier = (history.data?.masters ?? []).filter(m => !m.is_current)

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
              <div className="min-w-0 flex-1 basis-[220px]">
                <p className="truncate font-medium text-fg">{r.file?.filename || r.name || 'resume.pdf'}</p>
                <p className="flex flex-wrap items-center gap-x-2 text-[13px] text-muted">
                  <span>Uploaded {timeAgo(r.file?.created_at || r.date)}</span>
                  {r.file && <span>· {formatBytes(r.file.size_bytes)}</span>}
                  {r.inCloud
                    ? <span className="inline-flex items-center gap-1 text-success"><Cloud className="size-3.5" aria-hidden="true" /> Saved in the cloud</span>
                    : <span className="text-warning">Not in the cloud yet. Upload it again to keep a copy.</span>}
                </p>
              </div>
              <div className="flex gap-2 max-sm:w-full max-sm:justify-end">
                {r.file && <Button variant="ghost" icon={<Eye className="size-4" />} onClick={() => r.file && view(r.file)}>View</Button>}
                {r.file && <Button variant="ghost" icon={<Download className="size-4" />} onClick={() => r.file && get(r.file)}>Download</Button>}
                <Button onClick={() => input.current?.click()} loading={upload.isPending} icon={<Upload className="size-4" />}>Replace</Button>
              </div>
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
            <span className="text-[13px] text-muted">or click to choose a file · PDF only · up to 10 MB · older versions are kept</span>
            <input ref={input} type="file" accept="application/pdf,.pdf" className="sr-only" onChange={e => { pick(e.target.files?.[0]); e.target.value = '' }} />
          </label>

          <p className="text-[14px] text-muted">Which resume went to which job is under <Link to="/resumes/applied" className="text-accent hover:underline">Resumes → Applied</Link>.</p>

          <ResumeTemplate />

          {earlier.length > 0 && (
            <section aria-labelledby="earlier-h">
              <h2 id="earlier-h" className="mb-2 font-display text-[20px] font-semibold text-fg">Earlier versions</h2>
              <ul className="border-t border-rule">
                {earlier.map(m => (
                  <li key={m.id} className="flex items-center gap-3 border-b border-line py-2.5 text-[14px]">
                    <span className="min-w-0 flex-1 truncate text-fg">{m.filename}</span>
                    <span className="text-[13px] text-subtle">{timeAgo(m.created_at)} · {formatBytes(m.size_bytes)}</span>
                    <Button size="sm" variant="ghost" aria-label={`View ${m.filename}`} icon={<Eye className="size-3.5" />} onClick={() => view(m)} />
                    <Button size="sm" variant="ghost" aria-label={`Download ${m.filename}`} icon={<Download className="size-3.5" />} onClick={() => get(m)} />
                    {m.in_use
                      ? <span className="w-8 text-center text-subtle" title="An application uses this version, so it’s kept"><span className="sr-only">Kept: an application uses this version</span>·</span>
                      : <Button size="sm" variant="ghost" aria-label={`Delete ${m.filename} from ${timeAgo(m.created_at)}`} icon={<Trash2 className="size-3.5" />} onClick={() => setConfirmDelete(m)} />}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <PdfDialog file={viewing} onClose={() => setViewing(null)} />

          <ConfirmDialog
            open={confirmDelete != null}
            onCancel={() => setConfirmDelete(null)}
            onConfirm={() => confirmDelete && remove.mutate(confirmDelete.id)}
            title="Delete this version?"
            description={confirmDelete ? `${confirmDelete.filename}, uploaded ${timeAgo(confirmDelete.created_at)}, is removed from the cloud. Your current resume isn’t affected.` : ''}
            confirmLabel="Delete"
            danger
            busy={remove.isPending}
          />

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
