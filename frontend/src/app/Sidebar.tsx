import { Link, useLocation } from 'react-router-dom'
import { LogOut, Moon, Search, Sun } from 'lucide-react'
import { cn } from '@/lib/cn'
import { avatarFor } from '@/lib/format'
import { Kbd, StatusDot, type Tone } from '@/ui'
import { useAuth } from './auth'
import { ACCOUNT_SECTIONS, PRIMARY_SECTIONS, sectionFor } from './nav'
import { useServiceHealth } from './queries'
import { useTheme } from './theme'

const healthTone: Record<string, Tone> = { ok: 'success', warn: 'warning', down: 'danger', off: 'neutral' }

export function Sidebar({ onOpenPalette, onNavigate }: { onOpenPalette: () => void; onNavigate?: () => void }) {
  const { pathname } = useLocation()
  const active = sectionFor(pathname)
  const { email, signOut } = useAuth()
  const { theme, toggle } = useTheme()
  const { overall, isLoading } = useServiceHealth()
  const avatar = avatarFor(email)
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

  const item = (isActive: boolean) => cn(
    'flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium transition-colors',
    isActive ? 'bg-hover text-fg' : 'text-muted hover:bg-hover/60 hover:text-fg',
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 items-center gap-2 px-4">
        <span className="font-display text-[18px] font-semibold tracking-tight text-fg">Scout’n’Jobs</span>
      </div>

      <div className="px-3 pb-2">
        <button type="button" onClick={onOpenPalette}
          className="flex h-8 w-full items-center gap-2 rounded-md border border-line bg-canvas px-2.5 text-[13px] text-subtle transition-colors hover:border-line-strong hover:text-muted">
          <Search className="size-3.5" />
          <span className="flex-1 text-left">Search…</span>
          <Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd><Kbd>K</Kbd>
        </button>
      </div>

      <nav aria-label="Main" className="flex-1 space-y-0.5 overflow-y-auto px-3 py-1">
        {PRIMARY_SECTIONS.map(s => (
          // Plain Link: the active section is computed from sectionFor() (detail
          // pages belong to Jobs), and NavLink would override aria-current.
          <Link key={s.id} to={s.to} onClick={onNavigate} className={item(active?.id === s.id)}
            aria-current={active?.id === s.id ? 'page' : undefined}>
            <s.icon className="size-4 shrink-0" />
            {s.label}
          </Link>
        ))}
      </nav>

      <div className="space-y-0.5 border-t border-line px-3 py-2">
        <Link to="/usage" onClick={onNavigate}
          className="flex h-8 items-center gap-2.5 rounded-md px-2.5 text-xs text-subtle transition-colors hover:bg-hover/60 hover:text-muted"
          title="Service status">
          <StatusDot tone={isLoading ? 'neutral' : healthTone[overall.state] ?? 'neutral'} />
          <span className="truncate">{isLoading ? 'Checking services…' : overall.label}</span>
        </Link>
        {ACCOUNT_SECTIONS.map(s => (
          <Link key={s.id} to={s.to} onClick={onNavigate} className={item(active?.id === s.id)}
            aria-current={active?.id === s.id ? 'page' : undefined}>
            <s.icon className="size-4 shrink-0" />
            {s.label}
          </Link>
        ))}
        <button type="button" onClick={() => { onNavigate?.(); void signOut() }} className={cn(item(false), 'w-full')}>
          <LogOut className="size-4 shrink-0" />
          Sign out
        </button>
        <div className="flex items-center gap-2.5 px-2.5 pt-1.5 pb-1">
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-[10px] font-semibold text-accent">{avatar}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-muted" title={email}>{email}</span>
          <button type="button" onClick={toggle} className="rounded p-1 text-subtle hover:bg-hover hover:text-fg"
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
            {theme === 'dark' ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
          </button>
        </div>
      </div>
    </div>
  )
}
