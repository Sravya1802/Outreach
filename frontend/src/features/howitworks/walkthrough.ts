// The Walkthrough tab: what every section and tab in the app is for, in plain words.
// walkthrough.test.ts fails if a nav tab is added without a line here.
import type { NavSection } from '@/app/nav'

export interface SectionGuide {
  /** One sentence: what the section is for. */
  what: string
  /** When you'd open it. */
  when: string
  /** What each tab does, keyed by the tab's path in nav.ts. */
  tabs: Record<string, string>
  /** Tabs that live inside the page rather than in nav.ts (Settings). */
  extraTabs?: { label: string; to: string; does: string }[]
}

export const GUIDE: Record<NavSection['id'], SectionGuide> = {
  home: {
    what: 'Your starting point each day.',
    when: 'Open it first, every day.',
    tabs: {
      '/home': 'What needs you today, the best roles from your evening list with Approve and Skip, how far you’ve got, and what’s left to set up.',
    },
  },
  dashboard: {
    what: 'Your job search in numbers.',
    when: 'Open it to see how the search is going.',
    tabs: {
      '/dashboard': 'Applications per week and where each one stands, fit scores, outreach emails, referrals and this month’s cost. The tracker of every application you’ve made is here too.',
    },
  },
  jobs: {
    what: 'Every open role and company the app knows about.',
    when: 'Open it to browse what’s open, or to add companies to watch.',
    tabs: {
      '/jobs/roles': 'Internship and new-grad openings in your country, refreshed every morning. Search, filter, open the posting, or turn on email alerts.',
      '/jobs/companies': 'Companies grouped by industry. Find new ones, and open one to see its roles and the people you’ve found there.',
    },
  },
  applications: {
    what: 'Where you decide what to apply to.',
    when: 'Open it when your evening list arrives, or when you find a role yourself.',
    tabs: {
      '/applications/tracker': 'Every application as a sheet: company, role, link, submitted, status and referral. Change a status as you hear back, import your own spreadsheet as a CSV, or download it.',
      '/applications/auto-apply': 'Your evening list. Approve the roles you want and each gets a tailored resume, a referral ask, then an application. You also set the score cutoff and how many a day here.',
      '/applications/evaluate': 'Paste a job link or description and get a fit score out of 10 against your resume, with the reasons.',
    },
  },
  people: {
    what: 'Everyone you can ask for a referral, and what you’ve sent them.',
    when: 'Open it to reach out, or to check who replied.',
    tabs: {
      '/people/messages': 'Every company where you know someone. Each person gets a LinkedIn note and an email written for them. Copy, send, and mark as sent.',
      '/people/contacts': 'Everyone you’ve found at the companies you track, with an email address when one was found.',
      '/people/templates': 'The tone and shape the AI follows when it writes to someone. It still rewrites the details for each person.',
      '/people/outbox': 'Emails scheduled from your Gmail, their follow-ups, and the replies that came back. Needs Gmail connected.',
    },
  },
  integrations: {
    what: 'The accounts Scout’n’Jobs works through. All optional.',
    when: 'Open it once while setting up, or when something stops sending.',
    tabs: {
      '/integrations': 'What each connection does for you and whether it’s on.',
      '/integrations/gmail': 'Connect your Gmail with an app password, so emails go out as you and replies are read.',
      '/integrations/github': 'Sign in with GitHub and pick which repos tailored resumes can use as projects.',
      '/integrations/linkedin': 'Upload your LinkedIn connections export, so referral asks go to people you know.',
      '/integrations/whatsapp': 'Link your phone to get the evening list and alerts there, and approve roles by replying.',
    },
  },
  usage: {
    what: 'What the app is costing and whether it’s working.',
    when: 'Open it when something isn’t working, or to check spending. The coloured dot in the top bar leads here.',
    tabs: {
      '/usage': 'AI spending and email lookups this month against your limits, and the status of each outside service the app relies on.',
    },
  },
  how: {
    what: 'How the app works, in two views.',
    when: 'Open it when you’re not sure what happens next.',
    tabs: {
      '/how-it-works': 'This page: what every tab is for.',
      '/how-it-works/flow': 'Every stage a role and an outreach email goes through, using your own settings, with live counts of what’s at each stage.',
    },
  },
  profile: {
    what: 'What you tell the app about yourself, once. Under your initial at the top right.',
    when: 'Fill it in while setting up, and again when your resume changes.',
    tabs: {
      '/profile/details': 'Contact, work authorization and education, filled into every application. Can be filled in from your resume.',
      '/profile/resume': 'Your master resume. Every score and every tailored resume starts from it.',
      '/profile/projects': 'Projects to build, picked from the skills your listed roles keep asking for that your resume doesn’t show yet. Build one, push it to GitHub, mark it built, and your resumes can use it.',
      '/profile/answers': 'Answer common form questions once, like “Why us?” and start date. Every form that asks gets the same answer.',
    },
  },
  settings: {
    what: 'Your account. Under your initial at the top right.',
    when: 'Open it to change your password or theme, or to take your data out.',
    tabs: {},
    extraTabs: [
      { label: 'Account', to: '/settings/account', does: 'Your sign-in email, password, light or dark theme, and sign out.' },
      { label: 'Privacy', to: '/settings/privacy', does: 'Download everything stored for your account, or erase your sensitive profile.' },
    ],
  },
}

/** If you're new: the order that gets the app working for you. */
export const START_HERE = [
  { title: 'Upload your resume and fill in your details', body: 'Every role is scored against your resume, and every form is filled from your details.', to: '/profile/resume' },
  { title: 'Connect Gmail and import your LinkedIn connections', body: 'So referral asks go to people you know, from your own address.', to: '/integrations' },
  { title: 'Turn on your evening list', body: 'Each evening the day’s new roles are scored and the best ones land on Home.', to: '/applications/auto-apply' },
  { title: 'Approve the roles you want', body: 'Each one gets a referral ask first, then an application. Replies are tracked for you.', to: '/home' },
] as const
