// The setup checklist on Home: what auto-apply and automatic emails need before they can work for you.

export interface SetupInputs {
  hasResume: boolean | undefined
  profileComplete: boolean | undefined
  answers: number | undefined
  githubConnected: boolean | undefined
  /** Connected and Google still accepts the app password. */
  gmailConnected: boolean | undefined
  rulesSet: boolean | undefined
}

export interface SetupStep {
  id: 'resume' | 'details' | 'answers' | 'github' | 'gmail' | 'rules'
  title: string
  description: string
  to: string
  cta: string
  /** undefined = still loading */
  done: boolean | undefined
}

/** Saved answers that count as "started" on the common questions. */
export const MIN_ANSWERS = 3

export function setupSteps(i: SetupInputs): SetupStep[] {
  return [
    { id: 'resume', title: 'Upload your resume', description: 'Every evaluation and tailored resume starts from it.',
      to: '/profile/resume', cta: 'Upload', done: i.hasResume },
    { id: 'details', title: 'Fill in your details', description: 'Contact, work authorization and education, filled into every form.',
      to: '/profile/details', cta: 'Open', done: i.profileComplete },
    { id: 'answers', title: 'Answer the common questions', description: `“Why us?”, start date, salary and the like. At least ${MIN_ANSWERS}.`,
      to: '/profile/answers', cta: 'Answer', done: i.answers === undefined ? undefined : i.answers >= MIN_ANSWERS },
    { id: 'github', title: 'Connect GitHub', description: 'Your public repos become projects each resume can pick from.',
      to: '/integrations/github', cta: 'Connect', done: i.githubConnected },
    { id: 'gmail', title: 'Connect Gmail', description: 'Referral asks, follow-ups and your daily list go out from your own address, and replies are tracked.',
      to: '/integrations/gmail', cta: 'Connect', done: i.gmailConnected },
    { id: 'rules', title: 'Set your auto-apply rules', description: 'The score that puts a role on your daily plan, and how many a day.',
      to: '/jobs/auto-apply', cta: 'Set', done: i.rulesSet },
  ]
}

/** Name, email and phone are what every application form requires. */
export function isProfileComplete(profile: { first_name?: unknown; email?: unknown; phone?: unknown } | undefined): boolean | undefined {
  if (!profile) return undefined
  return ['first_name', 'email', 'phone'].every(k => String((profile as Record<string, unknown>)[k] ?? '').trim())
}

/** First name from the profile, else a readable name from the email. */
export function displayName(profile: { first_name?: unknown } | undefined, fallback: string): string {
  const first = String(profile?.first_name ?? '').trim()
  return first || fallback
}
