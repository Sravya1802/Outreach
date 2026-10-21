// pdf.js, loaded only when a PDF is first viewed. The legacy build covers
// older iPad and iPhone Safari versions.
import type * as PdfJs from 'pdfjs-dist/legacy/build/pdf.mjs'

let loading: Promise<typeof PdfJs> | null = null

export function loadPdfjs(): Promise<typeof PdfJs> {
  loading ??= Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
  ]).then(([lib, worker]) => {
    lib.GlobalWorkerOptions.workerSrc = worker.default
    return lib
  })
  return loading
}

/** Canvas size for one page: fits the width, sharp on retina, capped so iOS doesn't refuse to draw it. */
export function pageCanvasSize(pageWidth: number, pageHeight: number, boxWidth: number, zoom: number, dpr: number) {
  const cssWidth = Math.max(1, boxWidth * zoom)
  const scale = cssWidth / pageWidth
  const cssHeight = pageHeight * scale
  const MAX_PIXELS = 4096 * 4096 // iOS Safari's per-canvas limit is about 16.7M pixels
  let ratio = Math.min(dpr, 2)
  if (cssWidth * cssHeight * ratio * ratio > MAX_PIXELS) ratio = Math.sqrt(MAX_PIXELS / (cssWidth * cssHeight))
  return { cssWidth, cssHeight, scale: scale * ratio, pixelWidth: Math.floor(cssWidth * ratio), pixelHeight: Math.floor(cssHeight * ratio) }
}
