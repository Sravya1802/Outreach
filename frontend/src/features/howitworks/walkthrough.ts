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
    what: 'Your job search in numbers, and every application you’ve made.',
    when: 'Open it to see how the search is going, or to update where an application stands.',
    tabs: {
      '/dashboard': 'Applications per week and where each one stands, fit scores, outreach emails, referrals and this month’s cost.',
      '/dashboard/tracker': 'Every application as a sheet: company, role, link, submitted, status and referral. Change a status as you hear back, import your own spreadsheet as a CSV, or download it.',
    },
  },
  jobs: {
    what: 'Finding roles and deciding which to go after.',
    when: 'Open it to browse what’s open, when your evening list arrives, or when you find a role yourself.',
    tabs: {
      '/jobs/roles': 'Internship and new-grad openings in your country, refreshed every morning. Search, filter, open the posting, or turn on email alerts.',
      '/jobs/companies': 'Companies grouped by industry. Find new ones, and open one to see its roles and the people you’ve found there.',
      '/jobs/evaluate': 'Paste a job link or description and get a fit score out of 10 against your resume, with the reasons.',
      '/jobs/auto-apply': 'Your evening list. Approve the roles you want and each gets a tailored resume, a referral ask, then an application. You also set the score cutoff and how many a day here.',
    },
  },
  toapply: {
    what: 'Every job the app wrote a resume for, and whether it’s been applied to.',
    when: 'Open it each day to catch anything you missed, and to read the resumes you chose to review.',
    tabs: {
      '/to-apply': 'Newest list first. To do: roles waiting on you. Missed: roles from earlier lists nobody applied to. App is on it: roles the app is moving along. Approve with Apply for me (the app goes all the way) or I’ll review (it waits for you to read the resume, then Send it or apply yourself).',
    },
  },
  resumes: {
    what: 'Every resume the app writes, job by job, and the projects that could strengthen them.',
    when: 'Open it when your evening list arrives: every top role already has a draft to read, change or replace.',
    tabs: {
      '/resumes/jobs': 'One row per job: its fit score, the draft or tailored resume with its ATS match and interview chance, and which version will be sent. Open a job to see every change, download the PDF or LaTeX, or upload your own version, which is then sent as-is.',
      '/resumes/applied': 'Every role you’ve applied to and the exact resume that went with it. Roles whose resume is ready but not sent wait under Ready to apply: open the application, apply, and press I applied.',
      '/resumes/projects': 'Projects to build, picked from the skills your listed roles keep asking for that your resume doesn’t show yet. Build one, mark it built (a GitHub link is optional), and your resumes can use it.',
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
  profile: {
    what: 'You and your setup: your details, the master resume, connected accounts, spending, and how the app works.',
    when: 'Fill it in while setting up. Come back when your resume changes, to connect an account, or to check costs.',
    tabs: {
      '/profile/details': 'Contact, work authorization and education, filled into every application. Can be filled in from your resume.',
      '/profile/resume': 'Your master resume and the LaTeX template, plus which resume went to which job. Every score and every tailored resume starts from it. View any PDF right on the page.',
      '/profile/answers': 'Answer common form questions once, like “Why us?” and start date. Every form that asks gets the same answer.',
      '/integrations': 'Gmail, GitHub, LinkedIn and WhatsApp: what each one does for you, whether it’s connected, and where to set it up.',
      '/usage': 'AI spending and email lookups this month against your limits, and the status of each outside service the app relies on. The coloured dot in the top bar leads here.',
      '/how-it-works': 'What every tab is for, and every stage a role and an outreach email goes through, with live counts.',
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
  { title: 'Turn on your evening list', body: 'Each evening the day’s new roles are scored and the best ones land on Home.', to: '/jobs/auto-apply' },
  { title: 'Approve the roles you want', body: 'Each one gets a referral ask first, then an application. Replies are tracked for you.', to: '/home' },
] as const
