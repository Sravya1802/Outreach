// The first-run tour: one stop per tab along the top, then the account menu, the status dot and Help.
// Text comes from the Walkthrough guide so the two never disagree.
import { GUIDE } from '@/features/howitworks/walkthrough'
import { ACCOUNT_SECTIONS, PRIMARY_SECTIONS } from '../nav'

export interface TourStep {
  id: string
  /** data-tour value of the element to spotlight; none = centered card. */
  anchor?: string
  title: string
  body: string
  /** The section's own tabs, shown under the body. */
  tabs?: { label: string; does: string }[]
}

export function tourSteps(): TourStep[] {
  const sections = PRIMARY_SECTIONS.map<TourStep>(s => {
    const g = GUIDE[s.id]
    const tabs = s.tabs.map(t => ({ label: t.label, does: g.tabs[t.to] ?? '' }))
    // A one-tab section: its tab line is the detail, not a list of one.
    return tabs.length === 1
      ? { id: s.id, anchor: `nav-${s.id}`, title: s.label, body: `${g.what} ${tabs[0]?.does ?? ''}`.trim() }
      : { id: s.id, anchor: `nav-${s.id}`, title: s.label, body: `${g.what} ${g.when}`, tabs }
  })
  const account = ACCOUNT_SECTIONS.flatMap(s => {
    const g = GUIDE[s.id]
    return [...s.tabs.map(t => ({ label: t.label, does: g.tabs[t.to] ?? '' })), ...(g.extraTabs ?? []).map(t => ({ label: t.label, does: t.does }))]
  })
  return [
    { id: 'welcome', title: 'Welcome to Scout’n’Jobs',
      body: 'It finds roles that fit your resume, asks people you know for referrals, applies, and tracks the replies. Here’s what each tab along the top is for (on a phone they’re in the ☰ menu). It takes about a minute.' },
    ...sections,
    { id: 'account', anchor: 'account', title: 'Profile and Settings',
      body: 'Your initial opens your profile and settings. Fill in your profile once and every application uses it.', tabs: account },
    { id: 'status', anchor: 'status', title: 'Service status',
      body: 'Green means everything the app relies on is working. Amber or red means something is down; click it to see what on Usage.' },
    { id: 'help', anchor: 'help', title: 'Help is always here',
      body: 'Help sits in the bottom-right corner on every page. Open it to replay this tour or look up what any tab does.' },
  ]
}

/** Remembered per user, on this device and in the account, so it shows once. */
export const doneKey = (userId: string) => `snj.tour.done:${userId}`
