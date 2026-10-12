import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/cn'
import { Button } from './Button'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Modal shell: portal, backdrop, Esc/backdrop close, focus trap + restore, scroll lock. */
export function Dialog({ open, onClose, label, children, className, position = 'center' }: {
  open: boolean
  onClose: () => void
  label: string
  children: ReactNode
  className?: string
  position?: 'center' | 'top'
}) {
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const first = panel.current?.querySelector<HTMLElement>('[data-autofocus]') ?? panel.current?.querySelector<HTMLElement>(FOCUSABLE)
    first?.focus()

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return }
      if (e.key !== 'Tab' || !panel.current) return
      const nodes = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE))
      const firstNode = nodes[0]
      const lastNode = nodes[nodes.length - 1]
      if (!firstNode || !lastNode) return
      if (e.shiftKey && document.activeElement === firstNode) { e.preventDefault(); lastNode.focus() }
      else if (!e.shiftKey && document.activeElement === lastNode) { e.preventDefault(); firstNode.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      previouslyFocused?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div className={cn('fixed inset-0 z-[90] flex justify-center px-4', position === 'top' ? 'items-start pt-[12vh]' : 'items-center')}>
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" style={{ animation: 'ui-fade-in 120ms ease-out' }} onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={cn('relative w-full max-w-md rounded-xl border border-line bg-raised shadow-pop', className)}
        style={{ animation: 'ui-pop-in 140ms ease-out' }}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}

/** Promise-free confirm dialog (replaces window.confirm). */
export function ConfirmDialog({ open, title, description, confirmLabel, danger = false, busy = false, onConfirm, onCancel }: {
  open: boolean
  title: string
  description: ReactNode
  confirmLabel: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Dialog open={open} onClose={busy ? () => {} : onCancel} label={title}>
      <div className="p-5">
        <h2 className="text-[15px] font-semibold text-fg">{title}</h2>
        <div className="mt-2 text-[13px] text-muted">{description}</div>
      </div>
      <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
        <Button onClick={onCancel} disabled={busy} data-autofocus>Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={busy}>{confirmLabel}</Button>
      </div>
    </Dialog>
  )
}
