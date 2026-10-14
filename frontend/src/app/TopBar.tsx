import { Link, useLocation } from 'react-router-dom'
import { Moon, Search, Sun } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Kbd, StatusDot, type Tone } from '@/ui'
import { AccountMenu } from './AccountMenu'
import { PRIMARY_SECTIONS, sectionFor } from './nav'
import { useServiceHealth } from './queries'
import { useTheme } from './theme'

const healthTone: Record<string, Tone> = { ok: 'success', warn: 'warning', down: 'danger', off: 'neutral' }

/** Desktop navigation: wordmark, one link per section, then search, status, theme and account. */
export function TopBar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const { pathname } = useLocation()
  const active = sectionFor(pathname)
  const { theme, toggle } = useTheme()
  const { overall, isLoading } = useServiceHealth()
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

  return (
    <div className="mx-auto flex min-h-16 w-full max-w-7xl flex-wrap items-center gap-x-8 gap-y-2 px-4 sm:px-8">
      <Link to="/home" className="font-display text-[22px] font-semibold tracking-tight text-fg">OutreachOS</Link>

      <nav aria-label="Main" className="flex flex-1 flex-wrap items-center gap-1">
        {PRIMARY_SECTIONS.map(s => {
          const isActive = active?.id === s.id
          return (
            // Plain Link: the active section comes from sectionFor() (detail pages
            // belong to Jobs), and NavLink would override aria-current.
            <Link key={s.id} to={s.to} aria-current={isActive ? 'page' : undefined}
              className={cn('border-b-2 px-3 py-2 text-[14px] transition-colors',
                isActive ? 'border-accent font-semibold text-fg' : 'border-transparent text-muted hover:text-fg')}>
              {s.label}
            </Link>
          )
        })}
      </nav>

      <div className="flex items-center gap-2">
        <button type="button" onClick={onOpenPalette}
          className="flex h-8 items-center gap-2 rounded-[4px] border border-line px-2.5 text-[13px] text-subtle transition-colors hover:border-line-strong hover:text-muted">
          <Search className="size-3.5" />
          <span>Search</span>
          <Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd><Kbd>K</Kbd>
        </button>
        <Link to="/integrations/services" title={isLoading ? 'Checking services…' : overall.label}
          aria-label={`Service status: ${isLoading ? 'checking' : overall.label}`}
          className="grid size-8 place-items-center rounded-[4px] hover:bg-hover">
          <StatusDot tone={isLoading ? 'neutral' : healthTone[overall.state] ?? 'neutral'} />
        </Link>
        <button type="button" onClick={toggle} className="grid size-8 place-items-center rounded-[4px] text-subtle hover:bg-hover hover:text-fg"
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
          {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
        <AccountMenu />
      </div>
    </div>
  )
}
