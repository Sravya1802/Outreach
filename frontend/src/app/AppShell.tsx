import { Suspense, useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { PageSpinner } from '@/ui'
import { CommandPalette } from './CommandPalette'
import { sectionFor } from './nav'
import { ErrorBoundary } from './ErrorBoundary'
import { useLegacyEventBridge } from './queries'
import { Sidebar } from './Sidebar'

/** Horizontal tab bar for the current section (hidden when a section has one view). */
function SectionTabs() {
  const { pathname } = useLocation()
  const section = sectionFor(pathname)
  if (!section || section.tabs.length < 2) return null
  // The tab whose path is the longest prefix of the URL wins ("/home" vs "/home/analytics").
  const current = [...section.tabs]
    .sort((a, b) => b.to.length - a.to.length)
    .find(t => pathname === t.to || pathname.startsWith(`${t.to}/`))
  return (
    <div className="flex h-11 shrink-0 items-end gap-1 overflow-x-auto border-b border-line px-4 sm:px-6">
      {section.tabs.map(t => {
        const isActive = current?.to === t.to
        return (
          <Link key={t.to} to={t.to} aria-current={isActive ? 'page' : undefined}
            className={cn('relative flex h-11 items-center px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors',
              isActive ? 'text-fg' : 'text-subtle hover:text-muted')}>
            {t.label}
            {isActive && <span className="absolute inset-x-2.5 bottom-0 h-0.5 rounded-full bg-accent" />}
          </Link>
        )
      })}
    </div>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { pathname } = useLocation()
  const closePalette = useCallback(() => setPaletteOpen(false), [])
  const openPalette = useCallback(() => { setDrawerOpen(false); setPaletteOpen(true) }, [])
  const closeDrawer = useCallback(() => setDrawerOpen(false), [])
  useLegacyEventBridge()

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen(o => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex h-full overflow-hidden bg-canvas text-fg">
      <aside className="hidden w-60 shrink-0 border-r border-line bg-surface md:block">
        <Sidebar onOpenPalette={openPalette} />
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-[80] md:hidden">
          <div className="absolute inset-0 bg-black/55" onClick={closeDrawer} aria-hidden="true" style={{ animation: 'ui-fade-in 120ms ease-out' }} />
          <aside className="relative h-full w-72 max-w-[85vw] border-r border-line bg-surface shadow-pop" aria-label="Navigation">
            <button type="button" onClick={closeDrawer} aria-label="Close navigation"
              className="absolute top-3 right-3 rounded p-1.5 text-subtle hover:bg-hover hover:text-fg">
              <X className="size-4" />
            </button>
            <Sidebar onOpenPalette={openPalette} onNavigate={closeDrawer} />
          </aside>
        </div>
      )}

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3 md:hidden">
          <button type="button" onClick={() => setDrawerOpen(true)} aria-label="Open navigation"
            className="rounded-md p-1.5 text-muted hover:bg-hover hover:text-fg">
            <Menu className="size-5" />
          </button>
          <span className="text-[14px] font-semibold">OutreachOS</span>
        </div>
        <SectionTabs />
        <ErrorBoundary resetKey={pathname}>
          <Suspense fallback={<PageSpinner />}>{children}</Suspense>
        </ErrorBoundary>
      </main>

      {paletteOpen && <CommandPalette onClose={closePalette} />}
    </div>
  )
}
