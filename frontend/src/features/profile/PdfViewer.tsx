import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Download, ExternalLink, Minus, Plus, X } from 'lucide-react'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { api } from '@/lib/api'
import { Button, Dialog, ErrorState, Spinner, useToast } from '@/ui'
import { loadPdfjs, pageCanvasSize } from './pdfjs'
import { useOpenPdfTab } from './openPdfTab'

const ZOOMS = [0.75, 1, 1.25, 1.5, 2]

/** Every page of a stored PDF, drawn right on the page. */
export function PdfPages({ fileId, filename, zoom = 1 }: { fileId: number | string; filename: string; zoom?: number }) {
  const box = useRef<HTMLDivElement>(null)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    let cancelled = false
    let loaded: PDFDocumentProxy | null = null
    ;(async () => {
      const [pdfjs, blob] = await Promise.all([loadPdfjs(), api.resumeFileBlob(fileId)])
      const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) })
      loaded = await task.promise
      if (cancelled) { void loaded.destroy(); return }
      setDoc(loaded)
    })().catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e : new Error('Couldn’t open that PDF')) })
    return () => { cancelled = true; void loaded?.destroy() }
  }, [fileId, attempt])

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry?.contentRect.width ?? 0)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Draw (and redraw on resize or zoom). Pages are drawn in order so the first shows first.
  useEffect(() => {
    const el = box.current
    if (!doc || !el || width < 50) return
    let stop = false
    const tasks: RenderTask[] = []
    el.replaceChildren()
    ;(async () => {
      for (let n = 1; n <= doc.numPages && !stop; n++) {
        const page = await doc.getPage(n)
        const base = page.getViewport({ scale: 1 })
        const size = pageCanvasSize(base.width, base.height, width, zoom, window.devicePixelRatio || 1)
        const canvas = document.createElement('canvas')
        canvas.width = size.pixelWidth
        canvas.height = size.pixelHeight
        canvas.style.width = `${size.cssWidth}px`
        canvas.style.height = `${size.cssHeight}px`
        canvas.className = 'mx-auto block rounded-[2px] bg-white shadow-sm'
        canvas.setAttribute('role', 'img')
        canvas.setAttribute('aria-label', `${filename}, page ${n} of ${doc.numPages}`)
        const ctx = canvas.getContext('2d')
        if (!ctx || stop) return
        el.appendChild(canvas)
        const task = page.render({ canvasContext: ctx, viewport: page.getViewport({ scale: size.scale }) })
        tasks.push(task)
        await task.promise.catch(() => undefined)
      }
    })().catch(() => undefined)
    return () => { stop = true; tasks.forEach(t => t.cancel()) }
  }, [doc, width, zoom, filename])

  return (
    <div className="relative">
      {error ? <ErrorState error={error} onRetry={() => { setError(null); setAttempt(a => a + 1) }} />
        : !doc && <p className="flex items-center justify-center gap-2 py-16 text-[14px] text-muted" role="status"><Spinner /> Opening the PDF…</p>}
      <div ref={box} className="space-y-4 overflow-x-auto" />
    </div>
  )
}

export function PdfToolbar({ fileId, filename, zoom, onZoom }: { fileId: number | string; filename: string; zoom: number; onZoom: (z: number) => void }) {
  const toast = useToast()
  const openTab = useOpenPdfTab()
  const i = ZOOMS.indexOf(zoom)
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <div className="mr-1 flex items-center rounded-[4px] border border-line" role="group" aria-label="Zoom">
        <button type="button" className="grid size-8 place-items-center text-muted hover:text-fg disabled:opacity-40" aria-label="Zoom out"
          disabled={i <= 0} onClick={() => onZoom(ZOOMS[i - 1] ?? zoom)}><Minus className="size-3.5" /></button>
        <span className="w-12 text-center font-mono text-[12px] text-muted">{Math.round(zoom * 100)}%</span>
        <button type="button" className="grid size-8 place-items-center text-muted hover:text-fg disabled:opacity-40" aria-label="Zoom in"
          disabled={i >= ZOOMS.length - 1} onClick={() => onZoom(ZOOMS[i + 1] ?? zoom)}><Plus className="size-3.5" /></button>
      </div>
      <Button size="sm" variant="ghost" icon={<ExternalLink className="size-3.5" />} onClick={() => openTab(fileId)}>New tab</Button>
      <Button size="sm" variant="ghost" icon={<Download className="size-3.5" />}
        onClick={() => void api.downloadResumeFile(Number(fileId), filename).catch((e: Error) => toast.error(e.message))}>Download</Button>
    </div>
  )
}

/** A stored PDF in a large dialog over the current page. */
export function PdfDialog({ file, onClose }: { file: { id: number | string; filename: string; company?: string } | null; onClose: () => void }) {
  const [zoom, setZoom] = useState(1)
  if (!file) return null
  return (
    <Dialog open onClose={onClose} label={file.company ? `${file.filename} · ${file.company}` : file.filename} className="flex h-[92vh] max-w-5xl! flex-col overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <p className="min-w-0 truncate text-[14px] font-medium text-fg" title={file.filename}>
          {file.filename}
          {/* Every resume shares one name; the company says which one this is. */}
          {file.company && <span className="font-normal text-muted"> · {file.company}</span>}
        </p>
        <div className="flex items-center gap-1">
          <PdfToolbar fileId={file.id} filename={file.filename} zoom={zoom} onZoom={setZoom} />
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded text-subtle hover:bg-hover hover:text-fg">
            <X className="size-4" />
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto bg-canvas p-3 sm:p-5">
        <PdfPages key={file.id} fileId={file.id} filename={file.filename} zoom={zoom} />
      </div>
    </Dialog>
  )
}
