import type { CompanyDetail } from '@/lib/api'

// Job-board hosts are where a company posts roles, not its own website.
const ATS_HOSTS = /(greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|workable\.com|smartrecruiters\.com|icims\.com|jobvite\.com|workatastartup\.com|ycombinator\.com|linkedin\.com|indeed\.com)$/i

/** The company's own website host, e.g. "ramp.com" (never a job board). */
export function websiteHost(c: Pick<CompanyDetail, 'website' | 'domain'>): string | null {
  for (const raw of [c.website, c.domain]) {
    if (!raw) continue
    try {
      const host = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.replace(/^www\./, '')
      if (host && !ATS_HOSTS.test(host)) return host
    } catch { /* not a URL */ }
  }
  return null
}

/** A short description: the company's own, else Wikipedia's, minus disambiguation noise; cut at ~260 chars. */
export function companyBlurb(c: Pick<CompanyDetail, 'description' | 'wikipedia_summary'>): string {
  const text = [c.description, c.wikipedia_summary].map(t => (t ?? '').trim()).find(t => t && !/may refer to|disambiguation/i.test(t)) ?? ''
  if (text.length <= 260) return text
  const cut = text.slice(0, 260)
  return `${cut.slice(0, Math.max(cut.lastIndexOf('. ') + 1, cut.lastIndexOf(' '))).trim()}…`
}

/** Gmail compose link with the draft filled in. */
export function gmailComposeUrl(to: string, subject: string, body: string): string {
  const q = new URLSearchParams({ view: 'cm', fs: '1', to, su: subject, body })
  return `https://mail.google.com/mail/?${q.toString()}`
}
