import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { cn } from '@/lib/cn'
import { avatarFor, nameFromEmail } from '@/lib/format'
import { useAuth } from './auth'
import { ACCOUNT_SECTIONS, sectionFor } from './nav'

/** The avatar: opens Profile, Settings and Sign out. */
export function AccountMenu() {
  const { email, signOut } = useAuth()
  const { pathname } = useLocation()
  const active = sectionFor(pathname)
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const inMenu = ACCOUNT_SECTIONS.some(s => s.id === active?.id)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus() } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  return (
    <div ref={root} className="relative">
      <button ref={button} type="button" data-tour="account" onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open}
        aria-label={`Account menu for ${email}`} title={email}
        className={cn('grid size-8 place-items-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent ring-offset-2 ring-offset-canvas transition',
          (open || inMenu) && 'ring-2 ring-accent')}>
        {avatarFor(email)}
      </button>
      {open && (
        <div role="menu" aria-label="Account" className="absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-[4px] border border-line bg-surface shadow-lg">
          <div className="border-b border-line px-4 py-3">
            <p className="truncate text-[14px] font-medium text-fg">{nameFromEmail(email) === 'there' ? 'Your account' : nameFromEmail(email)}</p>
            <p className="truncate text-[12px] text-subtle">{email}</p>
          </div>
          <div className="py-1">
            {ACCOUNT_SECTIONS.map(s => (
              <Link key={s.id} to={s.to} role="menuitem" onClick={() => setOpen(false)}
                aria-current={active?.id === s.id ? 'page' : undefined}
                className={cn('flex items-center gap-2.5 px-4 py-2 text-[14px] hover:bg-hover', active?.id === s.id ? 'text-fg' : 'text-muted hover:text-fg')}>
                <s.icon className="size-4" aria-hidden="true" /> {s.label}
              </Link>
            ))}
          </div>
          <div className="border-t border-line py-1">
            <button type="button" role="menuitem" onClick={() => { setOpen(false); void signOut() }}
              className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-[14px] text-muted hover:bg-hover hover:text-fg">
              <LogOut className="size-4" aria-hidden="true" /> Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
