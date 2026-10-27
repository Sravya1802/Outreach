import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Building2, CornerDownLeft, LogOut, Moon, Search, Sun } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { matches } from '@/lib/search'
import { Dialog, Kbd, Spinner } from '@/ui'
import { useAuth } from './auth'
import { SECTIONS, allTabs } from './nav'
import { qk } from './queryClient'
import { useTheme } from './theme'

interface Command {
  id: string
  label: string
  group: 'Go to' | 'Companies' | 'Actions'
  hint?: string
  icon: ReactNode
  keywords: string
  run: () => void
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms)
    return () => window.clearTimeout(t)
  }, [value, ms])
  return v
}

/** Mount only while open (the shell does this) so every opening starts fresh. */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const { theme, toggle } = useTheme()
  const { signOut } = useAuth()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const debounced = useDebounced(query.trim(), 200)

  const companySearch = useQuery({
    queryKey: qk.companySearch(debounced),
    queryFn: () => api.searchCompanies(debounced),
    enabled: debounced.length >= 2,
    staleTime: 60_000,
  })

  const commands = useMemo<Command[]>(() => {
    const go = (to: string) => () => { navigate(to); onClose() }
    const nav: Command[] = SECTIONS.flatMap(s => {
      const Icon = s.icon
      const tabs = s.tabs.length ? allTabs(s) : [{ label: s.label, to: s.to, keywords: '' }]
      return tabs.map(t => ({
        id: `nav:${t.to}`,
        label: s.tabs.length && t.label !== s.label ? `${s.label} › ${t.label}` : s.label,
        group: 'Go to' as const,
        icon: <Icon className="size-4" />,
        keywords: `${s.label} ${t.label} ${t.keywords ?? ''}`,
        run: go(t.to),
      }))
    })
    const actions: Command[] = [
      {
        id: 'theme', label: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme', group: 'Actions',
        icon: theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />, keywords: 'theme dark light mode appearance',
        run: () => { toggle(); onClose() },
      },
      {
        id: 'signout', label: 'Sign out', group: 'Actions', icon: <LogOut className="size-4" />, keywords: 'log out logout sign out',
        run: () => { onClose(); void signOut() },
      },
    ]
    const q = query.trim()
    const filtered = q ? [...nav, ...actions].filter(c => matches(q, `${c.label} ${c.keywords}`)) : nav
    const companies: Command[] = q.length >= 2 && debounced === q
      ? (companySearch.data ?? []).map(c => ({
          id: `company:${c.id}`,
          label: c.name,
          hint: [c.category, c.location].filter(Boolean).join(' · '),
          group: 'Companies' as const,
          icon: <Building2 className="size-4" />,
          keywords: '',
          run: go(`/company/${c.id}`),
        }))
      : []
    return [...companies, ...filtered]
  }, [query, debounced, companySearch.data, navigate, onClose, theme, toggle, signOut])

  // Keep the highlight inside the list as results shrink.
  const active = Math.min(index, Math.max(commands.length - 1, 0))

  function onKeyDown(e: React.KeyboardEvent) {
    if (!commands.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((active + 1) % commands.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((active - 1 + commands.length) % commands.length) }
    else if (e.key === 'Enter') { e.preventDefault(); commands[active]?.run() }
  }

  const searching = query.trim().length >= 2 && (companySearch.isFetching || debounced !== query.trim())
  let lastGroup = ''

  return (
    <Dialog open onClose={onClose} label="Command palette" position="top" className="max-w-xl overflow-hidden">
      <div className="flex items-center gap-2.5 border-b border-line px-4">
        <Search className="size-4 shrink-0 text-subtle" />
        <input
          data-autofocus
          value={query}
          onChange={e => { setQuery(e.target.value); setIndex(0) }}
          onKeyDown={onKeyDown}
          placeholder="Search companies, pages and actions…"
          aria-label="Search"
          aria-controls="palette-list"
          aria-activedescendant={commands[active] ? `palette-${commands[active].id}` : undefined}
          className="h-12 flex-1 bg-transparent text-[14px] text-fg placeholder:text-subtle focus:outline-none"
        />
        {searching && <Spinner size={14} className="text-subtle" />}
      </div>
      <ul id="palette-list" role="listbox" className="max-h-[50vh] overflow-y-auto p-1.5">
        {commands.length === 0 && !searching && (
          <li className="px-3 py-8 text-center text-[13px] text-subtle">No results for “{query.trim()}”</li>
        )}
        {commands.map((c, i) => {
          const header = c.group !== lastGroup ? c.group : null
          lastGroup = c.group
          return (
            <li key={c.id} role="presentation">
              {header && <div className="px-2.5 pt-2 pb-1 text-[11px] font-medium text-subtle">{header}</div>}
              <div
                id={`palette-${c.id}`}
                role="option"
                aria-selected={i === active}
                onMouseMove={() => setIndex(i)}
                onClick={c.run}
                className={cn('flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-[13px]',
                  i === active ? 'bg-hover text-fg' : 'text-muted')}
              >
                <span className="text-subtle">{c.icon}</span>
                <span className="min-w-0 truncate">{c.label}</span>
                {c.hint && <span className="min-w-0 truncate text-xs text-subtle">{c.hint}</span>}
                {i === active && <CornerDownLeft className="ml-auto size-3.5 shrink-0 text-subtle" />}
              </div>
            </li>
          )
        })}
      </ul>
      <div className="flex items-center gap-3 border-t border-line px-4 py-2 text-[11px] text-subtle">
        <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
        <span className="flex items-center gap-1"><Kbd>↵</Kbd> open</span>
        <span className="flex items-center gap-1"><Kbd>esc</Kbd> close</span>
      </div>
    </Dialog>
  )
}
