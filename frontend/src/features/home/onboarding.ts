export interface SetupInputs {
  hasResume: boolean | undefined
  profileComplete: boolean | undefined
  companies: number | undefined
  evaluations: number | undefined
  nightlyEnabled: boolean | undefined
}

export interface SetupStep {
  id: string
  title: string
  description: string
  to: string
  cta: string
  /** undefined = still loading */
  done: boolean | undefined
}

export function setupSteps(i: SetupInputs): SetupStep[] {
  return [
    {
      id: 'resume', title: 'Upload your resume',
      description: 'Every evaluation and tailored CV starts from it.',
      to: '/applications/evaluate', cta: 'Upload', done: i.hasResume,
    },
    {
      id: 'profile', title: 'Fill in your application profile',
      description: 'Contact details, work authorization and education, used to fill applications for you.',
      to: '/profile/details', cta: 'Open profile', done: i.profileComplete,
    },
    {
      id: 'companies', title: 'Add companies to track',
      description: 'Pull companies from the YC directory and job boards.',
      to: '/jobs/companies?find=1', cta: 'Find companies', done: i.companies === undefined ? undefined : i.companies > 0,
    },
    {
      id: 'evaluate', title: 'Evaluate your first role',
      description: 'Paste a job link to get an A–F fit grade against your resume.',
      to: '/applications/evaluate', cta: 'Evaluate', done: i.evaluations === undefined ? undefined : i.evaluations > 0,
    },
    {
      id: 'nightly', title: 'Turn on nightly auto-apply',
      description: 'Scores new roles every night and applies to the strongest matches.',
      to: '/applications/auto-apply', cta: 'Set up', done: i.nightlyEnabled,
    },
  ]
}

export function isProfileComplete(profile: { first_name?: unknown; email?: unknown } | undefined): boolean | undefined {
  if (!profile) return undefined
  return Boolean(String(profile.first_name ?? '').trim() && String(profile.email ?? '').trim())
}
