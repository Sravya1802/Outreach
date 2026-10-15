import { Briefcase, Gauge, Home, Inbox, Plug, Settings, UserRound, Users, type LucideIcon } from 'lucide-react'

export interface NavTab {
  label: string
  to: string
  /** Extra words the command palette matches on. */
  keywords?: string
}

export interface NavSection {
  id: 'home' | 'jobs' | 'applications' | 'people' | 'integrations' | 'usage' | 'profile' | 'settings'
  label: string
  icon: LucideIcon
  to: string
  tabs: NavTab[]
  /** Path prefixes (besides `to`) that belong to this section, e.g. detail pages. */
  owns?: string[]
  /** Reached from the account menu (avatar) instead of the main bar. */
  inAccountMenu?: boolean
}

export const SECTIONS: NavSection[] = [
  {
    id: 'home', label: 'Home', icon: Home, to: '/home',
    tabs: [
      { label: 'Overview', to: '/home', keywords: 'dashboard today funnel stats analytics metrics' },
    ],
  },
  {
    id: 'jobs', label: 'Jobs', icon: Briefcase, to: '/jobs',
    owns: ['/company/'],
    tabs: [
      { label: 'Roles', to: '/jobs/roles', keywords: 'intern new grad catalog openings alerts email digest' },
      { label: 'Companies', to: '/jobs/companies', keywords: 'industries categories yc find scrape scraper linkedin wellfound add' },
    ],
  },
  {
    id: 'applications', label: 'Applications', icon: Inbox, to: '/applications',
    tabs: [
      { label: 'Auto-apply', to: '/applications/auto-apply', keywords: 'queue daily plan rules submit tracker pipeline board kanban sent applied interview offer follow up' },
      { label: 'Evaluate', to: '/applications/evaluate', keywords: 'score fit grade job link description' },
    ],
  },
  {
    id: 'people', label: 'People', icon: Users, to: '/people',
    tabs: [
      { label: 'Contacts', to: '/people/contacts', keywords: 'outreach referrals emails messages crm' },
      { label: 'Templates', to: '/people/templates', keywords: 'outreach email linkedin dm referral ask' },
      { label: 'Outbox', to: '/people/outbox', keywords: 'outreach gmail scheduled sent follow-ups replies' },
    ],
  },
  {
    id: 'integrations', label: 'Integrations', icon: Plug, to: '/integrations',
    tabs: [
      { label: 'Gmail', to: '/integrations/gmail', keywords: 'email app password connect send replies' },
      { label: 'GitHub', to: '/integrations/github', keywords: 'repos repositories projects connect sign in' },
    ],
  },
  {
    id: 'usage', label: 'Usage', icon: Gauge, to: '/usage',
    tabs: [{ label: 'Usage', to: '/usage', keywords: 'services status api keys health lookups hunter apollo prospeo ai spending cost limit' }],
  },
  {
    id: 'profile', label: 'Profile', icon: UserRound, to: '/profile',
    tabs: [
      { label: 'Details', to: '/profile/details', keywords: 'contact phone address work authorization visa sponsorship education gpa school degree' },
      { label: 'Resume', to: '/profile/resume', keywords: 'cv upload pdf master' },
      { label: 'Application answers', to: '/profile/answers', keywords: 'questions why us how did you hear salary start date answer bank' },
    ],
    inAccountMenu: true,
  },
  {
    id: 'settings', label: 'Settings', icon: Settings, to: '/settings',
    tabs: [],
    inAccountMenu: true,
  },
]

/** The main bar; Profile and Settings live under the avatar. */
export const PRIMARY_SECTIONS = SECTIONS.filter(s => !s.inAccountMenu)
export const ACCOUNT_SECTIONS = SECTIONS.filter(s => s.inAccountMenu)

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
  '/job-dashboard': '/home',
  '/discover/companies': '/jobs/companies',
  '/discover/scraper': '/jobs/find',
  '/discover/alerts': '/jobs/alerts',
  '/discover/evaluate': '/applications/evaluate',
  '/apply/auto-apply': '/applications/auto-apply',
  '/apply/pipeline': '/applications/auto-apply#tracker',
  '/apply/ranked': '/applications/auto-apply?sort=score#tracker',
  '/apply/intern-roles': '/jobs/roles/intern',
  '/apply/new-grad-roles': '/jobs/roles/new-grad',
  // The Outreach section was renamed People.
  '/outreach': '/people/contacts',
  '/outreach/contacts': '/people/contacts',
  '/outreach/templates': '/people/templates',
  '/outreach/outbox': '/people/outbox',
  '/outreach/messages': '/people/contacts',
  // Pre-IA-refactor paths
  '/companies': '/jobs/companies',
  '/scraper': '/jobs/find',
  '/career-ops-workflow': '/applications/evaluate',
  '/pipeline': '/applications/auto-apply#tracker',
  '/career-ops': '/applications/evaluate',
  '/career': '/applications/evaluate',
}
