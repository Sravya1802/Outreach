// Spotting a newer deploy: Vite names the entry bundle by content hash, so a
// different /assets/index-*.js in the live index.html means new code is out.

const ENTRY = /\/assets\/index-[\w-]+\.js/

/** The entry bundle path an index.html loads, or null (dev server, odd HTML). */
export function bundleFrom(html: string): string | null {
  return html.match(ENTRY)?.[0] ?? null
}

/** The entry bundle this tab is running. */
export function runningBundle(doc: Document = document): string | null {
  for (const s of doc.querySelectorAll<HTMLScriptElement>('script[type="module"][src]')) {
    const m = bundleFrom(s.getAttribute('src') ?? '')
    if (m) return m
  }
  return null
}

/** True when the live site has moved on from what this tab is running. */
export function isStale(running: string | null, live: string | null): boolean {
  return Boolean(running && live && running !== live)
}
