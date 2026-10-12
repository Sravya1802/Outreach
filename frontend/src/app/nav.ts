import { Briefcase, Home, Inbox, Send, Settings, type LucideIcon } from 'lucide-react'

export interface NavTab {
  label: string
  to: string
  /** Extra words the command palette matches on. */
  keywords?: string
}

export interface NavSection {
  id: 'home' | 'jobs' | 'applications' | 'outreach' | 'settings'
  label: string
  icon: LucideIcon
  to: string
  tabs: NavTab[]
  /** Path prefixes (besides `to`) that belong to this section, e.g. detail pages. */
  owns?: string[]
}

export const SECTIONS: NavSection[] = [
  {
    id: 'home', label: 'Home', icon: Home, to: '/home',
    tabs: [
      { label: 'Overview', to: '/home', keywords: 'dashboard today' },
      { label: 'Analytics', to: '/home/analytics', keywords: 'funnel stats metrics' },
    ],
  },
  {
    id: 'jobs', label: 'Jobs', icon: Briefcase, to: '/jobs',
    owns: ['/company/', '/category/'],
    tabs: [
      { label: 'Roles', to: '/jobs/roles', keywords: 'intern new grad catalog openings' },
      { label: 'Companies', to: '/jobs/companies', keywords: 'industries categories yc' },
      { label: 'Find companies', to: '/jobs/find', keywords: 'scrape scraper linkedin wellfound' },
      { label: 'Alerts', to: '/jobs/alerts', keywords: 'email digest notifications' },
    ],
  },
  {
    id: 'applications', label: 'Applications', icon: Inbox, to: '/applications',
    tabs: [
      { label: 'Evaluate', to: '/applications/evaluate', keywords: 'career ops score fit resume portal scan' },
      { label: 'Auto-apply', to: '/applications/auto-apply', keywords: 'queue run submit' },
      { label: 'Board', to: '/applications/board', keywords: 'pipeline kanban status' },
      { label: 'Ranked', to: '/applications/ranked', keywords: 'best match top picks' },
    ],
  },
  {
    id: 'outreach', label: 'Outreach', icon: Send, to: '/outreach',
    tabs: [
      { label: 'Contacts', to: '/outreach/contacts', keywords: 'people emails messages crm' },
      { label: 'Templates', to: '/outreach/templates', keywords: 'email linkedin dm' },
    ],
  },
  {
    id: 'settings', label: 'Settings', icon: Settings, to: '/settings',
    tabs: [],
  },
]

export const PRIMARY_SECTIONS = SECTIONS.filter(s => s.id !== 'settings')
export const SETTINGS_SECTION = { label: 'Settings', icon: Settings, to: '/settings' } as const

/** Which section a pathname belongs to (drives sidebar highlight + tab bar). */
export function sectionFor(pathname: string): NavSection | undefined {
  return SECTIONS.find(s =>
    pathname === s.to ||
    pathname.startsWith(`${s.to}/`) ||
    (s.owns ?? []).some(prefix => pathname.startsWith(prefix)),
  )
}

/**
 * Old URL → new URL. Legacy pages still link to their old paths internally,
 * and users have bookmarks, so every one of these must keep working.
 */
export const LEGACY_REDIRECTS: Record<string, string> = {
  '/': '/home',
  '/dashboard': '/home',
  '/job-dashboard': '/home/analytics',
  '/discover/companies': '/jobs/companies',
  '/discover/scraper': '/jobs/find',
  '/discover/alerts': '/jobs/alerts',
  '/discover/evaluate': '/applications/evaluate',
  '/apply/auto-apply': '/applications/auto-apply',
  '/apply/pipeline': '/applications/board',
  '/apply/ranked': '/applications/ranked',
  '/apply/intern-roles': '/jobs/roles/intern',
  '/apply/new-grad-roles': '/jobs/roles/new-grad',
  '/outreach/messages': '/outreach/contacts',
  // Pre-IA-refactor paths
  '/companies': '/jobs/companies',
  '/scraper': '/jobs/find',
  '/career-ops-workflow': '/applications/evaluate',
  '/pipeline': '/applications/board',
  '/career-ops': '/applications/ranked',
  '/career': '/applications/evaluate',
}
