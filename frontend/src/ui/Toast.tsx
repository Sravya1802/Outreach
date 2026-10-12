import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'
import { cn } from '@/lib/cn'

type ToastTone = 'success' | 'error' | 'info'
interface ToastItem { id: number; tone: ToastTone; message: string }
interface ToastApi {
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)
const DURATION_MS = 4500

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => setItems(list => list.filter(t => t.id !== id)), [])
  const push = useCallback((tone: ToastTone, message: string) => {
    const id = nextId.current++
    setItems(list => [...list.slice(-3), { id, tone, message }])
    window.setTimeout(() => dismiss(id), DURATION_MS)
  }, [dismiss])

  const api = useMemo<ToastApi>(() => ({
    success: m => push('success', m),
    error: m => push('error', m),
    info: m => push('info', m),
  }), [push])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6">
        {items.map(t => (
          <div key={t.id} role={t.tone === 'error' ? 'alert' : 'status'}
            className="pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-lg border border-line bg-raised px-3.5 py-3 text-[13px] text-fg shadow-pop"
            style={{ animation: 'ui-slide-up 160ms ease-out' }}>
            {t.tone === 'success' && <CheckCircle2 className="mt-px size-4 shrink-0 text-success" />}
            {t.tone === 'error' && <AlertCircle className="mt-px size-4 shrink-0 text-danger" />}
            {t.tone === 'info' && <Info className="mt-px size-4 shrink-0 text-info" />}
            <span className={cn('min-w-0 flex-1 break-words')}>{t.message}</span>
            <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss" className="-m-1 rounded p-1 text-subtle hover:text-fg">
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
