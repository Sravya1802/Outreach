// One entry of user_profile.experiences (normalized server-side by
// backend/services/experiences.js).
export interface Experience {
  company: string
  title: string
  location: string
  type: 'job' | 'internship' | 'research' | 'part_time' | 'volunteer'
  /** "YYYY-MM" */
  start: string
  end: string
  current: boolean
  summary: string
}

export const EXPERIENCE_TYPES: { value: Experience['type']; label: string }[] = [
  { value: 'internship', label: 'Internship' },
  { value: 'job', label: 'Full-time job' },
  { value: 'part_time', label: 'Part-time job' },
  { value: 'research', label: 'Research' },
  { value: 'volunteer', label: 'Volunteer' },
]

export const emptyExperience = (): Experience => ({ company: '', title: '', location: '', type: 'internship', start: '', end: '', current: false, summary: '' })

/** Saved profile value (array or JSON string) → entries the editor can use. */
export function readExperiences(raw: unknown): Experience[] {
  let list: unknown = raw
  if (typeof raw === 'string') { try { list = JSON.parse(raw) } catch { list = [] } }
  if (!Array.isArray(list)) return []
  return list.map(e => ({ ...emptyExperience(), ...(e && typeof e === 'object' ? e : {}) }) as Experience)
}
