import type { ActivityItem } from '@/lib/api'

const ACTION_LABELS: Record<string, string> = {
  scrape: 'Scraped companies',
  yc_import: 'Imported YC companies',
  yc_import_all: 'Imported YC companies',
  yc_waas_scrape: 'Scraped YC Work at a Startup',
  find_people: 'Found people',
  email_found: 'Found an email',
  outreach_sent: 'Sent outreach',
}

/** "scrape_roles" → "Scrape roles" for actions we don't have a label for. */
function humanize(action: string): string {
  const s = action.replace(/[_-]+/g, ' ').trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Activity'
}

export function activityTitle(a: Pick<ActivityItem, 'action'>): string {
  return ACTION_LABELS[a.action] ?? humanize(a.action)
}

/**
 * activity_log.details is TEXT, but some writers store JSON in it and some
 * drivers hand it back already parsed. Flatten either into a short summary.
 */
export function activityDetail(a: Pick<ActivityItem, 'details'>): string {
  let d: unknown = a.details
  if (d == null || d === '') return ''
  if (typeof d === 'string') {
    const trimmed = d.trim()
    if (!trimmed.startsWith('{')) return trimmed
    try { d = JSON.parse(trimmed) } catch { return trimmed }
  }
  if (typeof d !== 'object' || d === null) return String(d)
  const o = d as Record<string, unknown>
  const parts: string[] = []
  if (typeof o.subcategory === 'string') parts.push(o.subcategory)
  else if (typeof o.category === 'string') parts.push(o.category)
  if (typeof o.source === 'string') parts.push(o.source)
  const added = o.added ?? o.imported
  if (typeof added === 'number') parts.push(`+${added} new`)
  if (typeof o.updated === 'number' && o.updated) parts.push(`${o.updated} updated`)
  if (typeof o.skipped === 'number' && o.skipped) parts.push(`${o.skipped} skipped`)
  return parts.join(' · ')
}
