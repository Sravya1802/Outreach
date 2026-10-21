import { useCallback } from 'react'
import { api } from '@/lib/api'
import { useToast } from '@/ui'

/** "Open in new tab": a real link, opened inside the click so Safari doesn't block it. */
export function useOpenPdfTab() {
  const toast = useToast()
  return useCallback((fileId: number | string) => {
    const tab = window.open('', '_blank')
    api.resumeFileLink(fileId)
      .then(({ url }) => { if (tab) tab.location.href = url; else window.location.href = url })
      .catch((e: Error) => { tab?.close(); toast.error(e.message || 'Couldn’t open that PDF') })
  }, [toast])
}
