import { Suspense, useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { PageSpinner, StatusDot } from '@/ui'
import { STATE_LABEL, STATE_TONE } from '@/features/integrations/overview'
import { useIntegrations } from '@/features/integrations/useIntegrations'
import type { NavTab } from './nav'
import { CommandPalette } from './CommandPalette'
import { currentTab, sectionFor } from './nav'
import { ErrorBoundary } from './ErrorBoundary'
import { useLegacyEventBridge } from './queries'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { HelpLauncher } from './tour/HelpLauncher'
import { NewVersionBar } from './NewVersion'
import { TourProvider } from './tour/Tour'

function IntegrationDot({ id }: { id: NonNullable<NavTab['integration']> }) {
  const { cards } = useIntegrations()
  const c = cards.find(x => x.id === id)
  if (!c) return null
  return <StatusDot tone={STATE_TONE[c.state]} label={STATE_LABEL[c.state]} className="ml-1.5 align-middle" />
}

/** Horizontal tab bar for the current section (hidden when a section has one view). */
function SectionTabs() {
  const { pathname } = useLocation()
  const section = sectionFor(pathname)
  if (!section || section.tabs.length < 2) return null
  const current = currentTab(section.tabs, pathname)
  const sub = current?.sub
  const currentSub = sub ? currentTab(sub, pathname) : undefined
  return (
    <>
    <div className="border-b border-line">
      <div className="app-frame flex gap-6 overflow-x-auto px-4 sm:px-8">
        {section.tabs.map(t => {
          const isActive = current?.to === t.to
          return (
            <Link key={t.to} to={t.to} aria-current={isActive ? 'page' : undefined}
              className={cn('-mb-px border-b-2 py-2.5 text-[14px] whitespace-nowrap transition-colors',
                isActive ? 'border-accent font-semibold text-fg' : 'border-transparent text-muted hover:text-fg')}>
              {t.label}
              {t.integration && <IntegrationDot id={t.integration} />}
            </Link>
          )
        })}
      </div>
    </div>
    {sub && (
      // Second row: the open tab's own pages (Integrations → Gmail, GitHub…).
      <div className="border-b border-line bg-surface/60">
        <nav aria-label={current?.label} className="app-frame overflow-x-auto px-4 py-1.5 sm:px-8">
          {/* Pulled left by the pill padding so the words line up with the row above. */}
          <div className="-ml-2.5 flex gap-1">
          {sub.map(t => {
            const isActive = currentSub?.to === t.to
            return (
              <Link key={t.to} to={t.to} aria-current={isActive ? 'page' : undefined}
                className={cn('flex items-center rounded-[4px] px-2.5 py-1 text-[13px] whitespace-nowrap transition-colors',
                  isActive ? 'bg-accent-soft font-medium text-fg' : 'text-muted hover:bg-hover hover:text-fg')}>
                {t.label}
                {t.integration && <IntegrationDot id={t.integration} />}
              </Link>
            )
          })}
          </div>
        </nav>
      </div>
    )}
    </>
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
    <TourProvider>
    <div className="flex h-full flex-col overflow-hidden bg-canvas text-fg">
      <header className="shrink-0">
        <NewVersionBar />
        <div className="hidden border-b border-line lg:block">
          <TopBar onOpenPalette={openPalette} />
        </div>
        <div className="flex h-12 items-center gap-2 border-b border-line px-3 lg:hidden">
          <button type="button" onClick={() => setDrawerOpen(true)} aria-label="Open navigation"
            className="rounded-[4px] p-1.5 text-muted hover:bg-hover hover:text-fg">
            <Menu className="size-5" />
          </button>
          <span className="font-display text-[18px] font-semibold">Scout’n’Jobs</span>
        </div>
        <SectionTabs />
      </header>

      {drawerOpen && (
        <div className="fixed inset-0 z-[80] lg:hidden">
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

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <ErrorBoundary resetKey={pathname}>
          <Suspense fallback={<PageSpinner />}>{children}</Suspense>
        </ErrorBoundary>
      </main>

      {paletteOpen && <CommandPalette onClose={closePalette} />}
      <HelpLauncher />
    </div>
    </TourProvider>
  )
}
