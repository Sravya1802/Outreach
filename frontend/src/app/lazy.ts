import { lazy, type ComponentType } from 'react'

const CHUNK_ERROR = /Failed to fetch dynamically imported module|Loading chunk|Importing a module script failed/i

/**
 * lazy() that survives a redeploy: an open tab may request an old hashed chunk
 * the CDN no longer serves. Reload once to pick up the new HTML; if that still
 * fails, let the error boundary show it.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches React.lazy's own signature
export function lazyWithRetry<T extends ComponentType<any>>(load: () => Promise<{ default: T }>, name: string) {
  return lazy(async () => {
    const flag = `chunk-reload:${name}`
    try {
      const mod = await load()
      try { sessionStorage.removeItem(flag) } catch { /* storage blocked */ }
      return mod
    } catch (err) {
      let alreadyRetried = true
      try { alreadyRetried = Boolean(sessionStorage.getItem(flag)) } catch { /* storage blocked */ }
      if (CHUNK_ERROR.test(String((err as Error)?.message)) && !alreadyRetried) {
        try { sessionStorage.setItem(flag, '1') } catch { /* storage blocked */ }
        window.location.reload()
        return new Promise<never>(() => {})
      }
      throw err
    }
  })
}
