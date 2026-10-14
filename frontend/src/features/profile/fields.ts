// The application profile, as a schema the Details form renders from.
// Option values match what the backend and the auto-apply form filler
// already store and read (user_profile columns).

import { MARKETS } from '@/lib/markets'

export interface Option { value: string; label: string }

export interface FieldDef {
  key: string
  label: string
  kind?: 'text' | 'email' | 'tel' | 'url' | 'select' | 'textarea'
  options?: Option[]
  placeholder?: string
  hint?: string
  /** Stored as INT 0/1 in user_profile. */
  numeric?: boolean
  /** Spans the full row. */
  wide?: boolean
  autoComplete?: string
}

export interface SectionDef {
  id: string
  title: string
  description: string
  fields: FieldDef[]
  /** Fields are disabled until this boolean key is on. */
  gatedBy?: string
}

const YES_NO: Option[] = [{ value: '0', label: 'No' }, { value: '1', label: 'Yes' }]
const DECLINE: Option = { value: '', label: 'Decline to answer' }

export const SECTIONS: SectionDef[] = [
  {
    id: 'contact', title: 'Contact', description: 'Every form asks for these. Name, email and phone are required before anything is submitted for you.',
    fields: [
      { key: 'first_name', label: 'First name', autoComplete: 'given-name' },
      { key: 'last_name', label: 'Last name', autoComplete: 'family-name' },
      { key: 'email', label: 'Email', kind: 'email', autoComplete: 'email' },
      { key: 'phone', label: 'Phone', kind: 'tel', placeholder: '+1 555 123 4567', autoComplete: 'tel' },
      { key: 'location', label: 'Location', placeholder: 'Boston, MA', hint: 'The one-line location most forms ask for.', wide: true },
      { key: 'address', label: 'Street address', wide: true, autoComplete: 'street-address' },
      { key: 'city', label: 'City', autoComplete: 'address-level2' },
      { key: 'state_province', label: 'State / province', autoComplete: 'address-level1' },
      { key: 'postal_code', label: 'ZIP / postal code', autoComplete: 'postal-code' },
      { key: 'country', label: 'Country', placeholder: 'US', autoComplete: 'country' },
    ],
  },
  {
    id: 'links', title: 'Links', description: 'Shown on your resume and pasted into the link fields on forms.',
    fields: [
      { key: 'linkedin_url', label: 'LinkedIn', kind: 'url', placeholder: 'https://www.linkedin.com/in/…' },
      { key: 'github_url', label: 'GitHub', kind: 'url', placeholder: 'https://github.com/…' },
      { key: 'portfolio_url', label: 'Portfolio or website', kind: 'url', wide: true },
    ],
  },
  {
    id: 'work', title: 'Work authorization', description: 'Roles that say they won’t sponsor are skipped automatically when you need sponsorship.',
    fields: [
      { key: 'work_authorization', label: 'Status', kind: 'select', options: [{ value: '', label: 'Choose…' }, ...['US Citizen', 'Permanent Resident', 'F-1 (OPT/STEM)', 'H-1B', 'TN Visa', 'Other'].map(v => ({ value: v, label: v }))] },
      { key: 'needs_sponsorship', label: 'Will you need visa sponsorship?', kind: 'select', options: YES_NO, numeric: true },
    ],
  },
  {
    id: 'education', title: 'Education', description: 'Your current or most recent degree.',
    fields: [
      { key: 'education_school', label: 'School', wide: true },
      { key: 'education_degree', label: 'Degree', placeholder: 'M.S.' },
      { key: 'education_major', label: 'Major', placeholder: 'Computer Science' },
      { key: 'graduation_date', label: 'Graduation', placeholder: 'May 2028' },
      { key: 'gpa', label: 'GPA', placeholder: '3.9 / 4.0', hint: 'Leave empty and forms that ask will wait for you.' },
    ],
  },
  {
    id: 'experience', title: 'Experience', description: 'Used where a form asks for your current role. The resume itself comes from your uploaded file.',
    fields: [
      { key: 'current_company', label: 'Current or last company' },
      { key: 'current_title', label: 'Title' },
      { key: 'years_experience', label: 'Years of experience', placeholder: '1' },
      { key: 'certifications', label: 'Certifications' },
      { key: 'skills', label: 'Skills', kind: 'textarea', wide: true, placeholder: 'Python, TypeScript, Kafka, Spark, React, PostgreSQL…' },
    ],
  },
  {
    id: 'preferences', title: 'What you’re looking for', description: 'Filters which roles get scored and planned.',
    fields: [
      { key: 'job_market', label: 'Looking for jobs in', kind: 'select', options: MARKETS.map(m => ({ value: m.value, label: m.label })), hint: 'Every role list, alert and auto-apply plan follows this.' },
      { key: 'target_job_type', label: 'Role type', kind: 'select', options: [{ value: 'intern', label: 'Internship' }, { value: 'new_grad', label: 'New grad / entry level' }, { value: 'full_time', label: 'Full-time' }, { value: 'any', label: 'Any' }] },
      { key: 'work_location_preference', label: 'Work setting', kind: 'select', options: [{ value: 'any', label: 'Any' }, { value: 'remote', label: 'Remote' }, { value: 'hybrid', label: 'Hybrid' }, { value: 'onsite', label: 'On-site' }] },
      { key: 'willing_to_relocate', label: 'Willing to relocate?', kind: 'select', options: YES_NO, numeric: true },
      { key: 'preferred_locations', label: 'Preferred locations', placeholder: 'New York, San Francisco Bay Area, Seattle' },
    ],
  },
  {
    id: 'demographics', title: 'Voluntary self-identification', description: 'Optional. Only stored if you turn this on, and turning it off erases the answers. Forms otherwise get “decline to answer”.',
    gatedBy: 'demographic_consent',
    fields: [
      { key: 'gender', label: 'Gender', kind: 'select', options: [DECLINE, { value: 'female', label: 'Female' }, { value: 'male', label: 'Male' }, { value: 'non_binary', label: 'Non-binary' }, { value: 'self_describe', label: 'I prefer to self-describe' }] },
      { key: 'race', label: 'Race / ethnicity', kind: 'select', options: [DECLINE, { value: 'asian', label: 'Asian' }, { value: 'black', label: 'Black or African American' }, { value: 'hispanic_latino', label: 'Hispanic or Latino' }, { value: 'white', label: 'White' }, { value: 'two_or_more', label: 'Two or more races' }, { value: 'self_describe', label: 'I prefer to self-describe' }] },
      { key: 'veteran_status', label: 'Veteran status', kind: 'select', options: [DECLINE, { value: 'not_veteran', label: 'I am not a protected veteran' }, { value: 'protected_veteran', label: 'I identify as a protected veteran' }] },
      { key: 'disability_status', label: 'Disability', kind: 'select', options: [DECLINE, { value: 'no', label: 'No, I do not have a disability' }, { value: 'yes', label: 'Yes, I have a disability' }] },
    ],
  },
]

export const ALL_FIELDS = SECTIONS.flatMap(s => s.fields)
export const CONSENT_KEYS = ['demographic_consent', 'auto_apply_consent'] as const
export const DEMOGRAPHIC_KEYS = SECTIONS.find(s => s.id === 'demographics')?.fields.map(f => f.key) ?? []

/** Fields every submission needs; auto-apply refuses to run without them. */
export const REQUIRED_KEYS = ['first_name', 'last_name', 'email', 'phone']
/** Fields most forms ask for; shown as the completeness count. */
export const IMPORTANT_KEYS = [...REQUIRED_KEYS, 'location', 'linkedin_url', 'work_authorization', 'education_school', 'education_degree', 'education_major', 'graduation_date']

export type FormValues = Record<string, string>

const asText = (v: unknown): string => (v == null ? '' : String(v))

/** Profile row → string form values (INT flags become '0'/'1'). */
export function toForm(profile: Record<string, unknown> | undefined): FormValues {
  const out: FormValues = {}
  for (const f of ALL_FIELDS) {
    const v = profile?.[f.key]
    out[f.key] = f.numeric ? (Number(v) === 1 ? '1' : '0') : asText(v)
  }
  // Selects without a stored value show their first option; store that too.
  for (const f of ALL_FIELDS) if (f.kind === 'select' && !f.numeric && !out[f.key] && f.options?.[0]) out[f.key] = f.options[0].value
  for (const k of CONSENT_KEYS) out[k] = Number(profile?.[k]) === 1 ? '1' : '0'
  return out
}

/** Form values → PUT body. Demographics are only sent with consent. */
export function toPatch(values: FormValues): Record<string, string | number | null> {
  const consent = values.demographic_consent === '1'
  const patch: Record<string, string | number | null> = {}
  for (const f of ALL_FIELDS) {
    if (DEMOGRAPHIC_KEYS.includes(f.key) && !consent) continue
    const v = (values[f.key] ?? '').trim()
    patch[f.key] = f.numeric ? (v === '1' ? 1 : 0) : (v || null)
  }
  for (const k of CONSENT_KEYS) patch[k] = values[k] === '1' ? 1 : 0
  return patch
}

export function missing(values: FormValues, keys: string[]): string[] {
  return keys.filter(k => !(values[k] ?? '').trim())
}

export function labelFor(key: string): string {
  return ALL_FIELDS.find(f => f.key === key)?.label ?? key
}
