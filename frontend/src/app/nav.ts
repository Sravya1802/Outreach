import { Briefcase, ChartColumnBig, FileText, Home, ListChecks, Settings, UserRound, Users, type LucideIcon } from 'lucide-react'

export interface NavTab {
  label: string
  to: string
  /** Extra words the command palette matches on. */
  keywords?: string
  /** Show this integration's connected/not dot beside the tab. */
  integration?: 'gmail' | 'github' | 'linkedin' | 'whatsapp'
  /** A second row of tabs shown under this one while it's open. */
  sub?: NavTab[]
}

export interface NavSection {
  id: 'home' | 'dashboard' | 'jobs' | 'toapply' | 'resumes' | 'people' | 'profile' | 'settings'
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
      { label: 'Overview', to: '/home', keywords: 'today queue picks setup' },
    ],
  },
  {
    id: 'dashboard', label: 'Dashboard', icon: ChartColumnBig, to: '/dashboard',
    tabs: [
      { label: 'Overview', to: '/dashboard', keywords: 'analytics stats numbers charts metrics response rate interviews funnel' },
      { label: 'Tracker', to: '/dashboard/tracker', keywords: 'sheet spreadsheet applications submitted status rejected waiting referral import csv google sheets monitor' },
    ],
  },
  {
    id: 'jobs', label: 'Jobs', icon: Briefcase, to: '/jobs',
    owns: ['/company/'],
    tabs: [
      { label: 'Roles', to: '/jobs/roles', keywords: 'intern new grad catalog openings alerts email digest' },
      { label: 'Companies', to: '/jobs/companies', keywords: 'industries categories yc find scrape scraper linkedin wellfound add' },
      { label: 'Evaluate', to: '/jobs/evaluate', keywords: 'score fit grade job link description' },
      { label: 'Auto-apply', to: '/jobs/auto-apply', keywords: 'queue daily plan evening list rules submit approve referral apply applications' },
    ],
  },
  {
    id: 'toapply', label: 'To apply', icon: ListChecks, to: '/to-apply',
    tabs: [{ label: 'To apply', to: '/to-apply', keywords: 'missed apply review send it approved resumes written not applied follow through' }],
  },
  {
    id: 'resumes', label: 'Resumes', icon: FileText, to: '/resumes',
    owns: ['/resumes/job/'],
    tabs: [
      { label: 'By job', to: '/resumes/jobs', keywords: 'tailored resume drafts evaluations ats interview chance cover letter upload my version download pdf' },
      { label: 'Applied', to: '/resumes/applied', keywords: 'applications sent submitted which resume went where manual apply i applied ready to apply' },
      { label: 'Projects', to: '/resumes/projects', keywords: 'portfolio build github project ideas suggestions gaps skills' },
    ],
  },
  {
    id: 'people', label: 'People', icon: Users, to: '/people',
    tabs: [
      { label: 'Messages', to: '/people/messages', keywords: 'linkedin notes connections personalized email copy send referral' },
      { label: 'Contacts', to: '/people/contacts', keywords: 'outreach referrals emails messages crm' },
      { label: 'Templates', to: '/people/templates', keywords: 'outreach email linkedin dm referral ask' },
      { label: 'Outbox', to: '/people/outbox', keywords: 'outreach gmail scheduled sent follow-ups replies' },
    ],
  },
  {
    // Everything about you and your account's setup: the resume every tailored
    // one starts from, connected accounts, spending, and how the app works.
    id: 'profile', label: 'Profile', icon: UserRound, to: '/profile',
    owns: ['/integrations', '/usage', '/how-it-works'],
    tabs: [
      { label: 'Details', to: '/profile/details', keywords: 'contact phone address work authorization visa sponsorship education gpa school degree' },
      { label: 'Master resume', to: '/profile/resume', keywords: 'cv upload pdf master template latex which resume went where' },
      { label: 'Application answers', to: '/profile/answers', keywords: 'questions why us how did you hear salary start date answer bank' },
      {
        label: 'Integrations', to: '/integrations', keywords: 'connect accounts gmail github linkedin whatsapp',
        sub: [
          { label: 'Overview', to: '/integrations', keywords: 'connect accounts what does it do explained' },
          { label: 'Gmail', to: '/integrations/gmail', keywords: 'email app password connect send replies', integration: 'gmail' },
          { label: 'GitHub', to: '/integrations/github', keywords: 'repos repositories projects connect sign in', integration: 'github' },
          { label: 'LinkedIn', to: '/integrations/linkedin', keywords: 'connections referrals network export csv', integration: 'linkedin' },
          { label: 'WhatsApp', to: '/integrations/whatsapp', keywords: 'phone messages approve reply alerts notifications', integration: 'whatsapp' },
        ],
      },
      { label: 'Usage', to: '/usage', keywords: 'services status api keys health lookups hunter apollo prospeo ai spending cost limit' },
      {
        label: 'How it works', to: '/how-it-works', keywords: 'help guide explained',
        sub: [
          { label: 'Walkthrough', to: '/how-it-works', keywords: 'tour guide help what does each tab do explained new start here' },
          { label: 'Your queue, live', to: '/how-it-works/flow', keywords: 'queue pipeline steps evening list referral apply emails outreach follow up explained' },
        ],
      },
    ],
  },
  {
    id: 'settings', label: 'Settings', icon: Settings, to: '/settings',
    tabs: [],
    inAccountMenu: true,
  },
]

/** The main bar; Settings lives under the avatar. */
export const PRIMARY_SECTIONS = SECTIONS.filter(s => !s.inAccountMenu)
export const ACCOUNT_SECTIONS = SECTIONS.filter(s => s.inAccountMenu)

/** The tab whose path is the longest prefix of the URL ("/integrations" vs "/integrations/gmail"). */
export function currentTab(tabs: NavTab[], pathname: string): NavTab | undefined {
  return [...tabs]
    .sort((a, b) => b.to.length - a.to.length)
    .find(t => pathname === t.to || pathname.startsWith(`${t.to}/`))
}

/** Every tab, including second-row ones (for search). */
export function allTabs(section: NavSection): NavTab[] {
  return section.tabs.flatMap(t => [t, ...(t.sub ?? []).filter(st => st.to !== t.to)])
}

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
  // The Applications section was split: Evaluate and Auto-apply moved to Jobs, Tracker to Dashboard.
  '/applications/auto-apply': '/jobs/auto-apply',
  '/applications/evaluate': '/jobs/evaluate',
  '/applications/tracker': '/dashboard/tracker',
  '/': '/home',
  '/job-dashboard': '/home',
  '/discover/companies': '/jobs/companies',
  '/discover/scraper': '/jobs/find',
  '/discover/alerts': '/jobs/alerts',
  '/discover/evaluate': '/jobs/evaluate',
  '/apply/auto-apply': '/jobs/auto-apply',
  '/apply/pipeline': '/dashboard#tracker',
  '/apply/ranked': '/dashboard?sort=score#tracker',
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
  '/career-ops-workflow': '/jobs/evaluate',
  '/pipeline': '/dashboard#tracker',
  '/career-ops': '/jobs/evaluate',
  '/career': '/jobs/evaluate',
}
