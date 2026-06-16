// ─────────────────────────────────────────────────────────────────────────────
// OutreachOS frontend → backend API client.
//
// Every route hits the Express backend at VITE_API_URL (Oracle VM in prod,
// '' in dev for vite proxy). No direct Supabase table access — the backend
// owns all data access and business logic. Supabase is only used for auth:
//   - App.jsx / Login.jsx drive the login flow
//   - this module reads the current session JWT and attaches it to every
//     outbound request (Authorization: Bearer <jwt>).
//
// Downloads / report views fetch the resource with the Bearer header, then
// open it as a blob: URL — JWTs no longer leak into address bars, browser
// history, server access logs, or Referer headers.
//
// EventSource (SSE) is the one carve-out: it can't send headers, so the SSE
// helpers append ?access_token=<jwt> via withAuthQuery. The backend middleware
// accepts either source.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from './supabaseClient.js'

const ENV = import.meta.env || {}
const BASE = ENV.VITE_API_URL ? ENV.VITE_API_URL.replace(/\/$/, '') : ''
export const API = `${BASE}/api`
export const apiUrl = (path = '') => `${API}${path.startsWith('/') ? path : `/${path}`}`

const isFormData = (body) => typeof FormData !== 'undefined' && body instanceof FormData

// ── Auth token plumbing ─────────────────────────────────────────────────────
// SSE helpers (EventSource-based streams) need a sync read of the current JWT,
// since EventSource cannot send Authorization headers. Keep a cached copy
// updated by Supabase's auth state. Non-streaming requests use authHeaders()
// which always grabs the freshest session token.
let cachedToken = null
try {
  supabase.auth.getSession().then(({ data: { session } }) => {
    cachedToken = session?.access_token || null
  }).catch(() => {})
  supabase.auth.onAuthStateChange((_event, session) => {
    cachedToken = session?.access_token || null
  })
} catch { /* placeholder client in tests — stays unauthenticated */ }

export function withAuthQuery(url) {
  if (!cachedToken) return url
  return url + (url.includes('?') ? '&' : '?') + 'access_token=' + encodeURIComponent(cachedToken)
}

// fetch-based calls get the freshest token (session may have auto-refreshed).
async function authHeaders() {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}
  } catch { return {} }
}

async function apiCall(url, options = {}) {
  const auth = await authHeaders()
  const init = {
    method: options.method || 'GET',
    headers: options.headers !== undefined
      ? { ...auth, ...options.headers }
      : { ...auth, ...(isFormData(options.body) ? {} : { 'Content-Type': 'application/json' }) },
  }
  if (options.body !== undefined) {
    init.body = isFormData(options.body) ? options.body : JSON.stringify(options.body)
  }
  // Distinguish three failure modes: network-level (fetch threw), HTTP error
  // with JSON body, HTTP error with non-JSON body. The bare "Failed to fetch"
  // browser default is unhelpful — surface a more actionable hint instead.
  let res
  try {
    res = await fetch(apiUrl(url), init)
  } catch (err) {
    const isFetchFail = /Failed to fetch|NetworkError|TypeError/i.test(err?.message || '')
    if (isFetchFail) {
      const isAuthRefresh = !auth.Authorization
      const hint = isAuthRefresh
        ? "Couldn't reach the backend — check that you're signed in (session may have expired)."
        : "Couldn't reach the backend at " + apiUrl(url) + ". Check connection / VPN / backend status, then retry."
      throw new Error(hint)
    }
    throw err
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `Request failed (HTTP ${res.status})`)
  }
  return res.json()
}

async function statsWithContactSummary() {
  const stats = await apiCall('/stats')
  const metrics = await apiCall('/dashboard/job-metrics').catch(() => null)
  const summary = metrics?.summary || {}
  return {
    ...stats,
    totalContacts: summary.totalContacts ?? stats.totalContacts,
    contactsWithEmail: summary.contactsWithEmail ?? stats.contactsWithEmail,
    totalLinkedInContacts: summary.contactsWithLinkedIn ?? stats.totalLinkedInContacts,
    outreachSent: summary.outreachSent ?? stats.totalSent,
    outreachReplied: summary.outreachReplied ?? stats.totalReplied,
  }
}

export async function rawApiFetch(url, options = {}) {
  const auth = await authHeaders()
  const headers = options.headers ? { ...auth, ...options.headers } : auth
  return fetch(apiUrl(url), { ...options, headers })
}

async function fetchAuthenticatedBlob(path) {
  const res = await rawApiFetch(path)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || 'Request failed')
  }
  return res.blob()
}

// Open a backend resource in a new tab using a blob URL — keeps the JWT in
// the Authorization header rather than leaking it via ?access_token=.
export async function openAuthenticatedTab(path) {
  const blob = await fetchAuthenticatedBlob(path)
  const url = URL.createObjectURL(blob)
  const w = window.open(url, '_blank', 'noopener,noreferrer')
  // Revoke later so the new tab has time to load before the URL is freed.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return w
}

// Trigger a file download via blob URL with the suggested filename.
export async function downloadAuthenticatedFile(path, filename) {
  const blob = await fetchAuthenticatedBlob(path)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  if (filename) a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5_000)
}

const qs = (params) => {
  const entries = Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== '')
  return entries.length ? '?' + new URLSearchParams(entries).toString() : ''
}

export const api = {
  health:     () => apiCall('/health'),
  stats:      () => statsWithContactSummary(),
  activity:   () => apiCall('/activity'),
  jobMetrics: () => apiCall('/dashboard/job-metrics'),
  dailyUpdates: () => apiCall('/dashboard/daily-updates'),

  // Job-alert subscription (LinkedIn-style email digests of new roles)
  alerts: {
    get:  ()      => apiCall('/alerts/subscription'),
    save: (sub)   => apiCall('/alerts/subscription', { method: 'PUT', body: sub }),
    test: (email) => apiCall('/alerts/test', { method: 'POST', body: { email } }),
  },

  credits: {
    status: (force = false) => apiCall('/credits/status' + (force ? '?refresh=true' : '')).catch(() => ({})),
  },

  // Global daily-scraped role catalog. Shared across users; cron repopulates
  // at 06:15 UTC. The `track` and `autoApply` actions create per-user
  // evaluations rows the Auto Apply queue picks up.
  scrapedRoles: {
    list: ({ roleType = 'intern', source = '', search = '', page = 0, pageSize = 50 } = {}) => {
      const qs = new URLSearchParams({ role_type: roleType, page: String(page), pageSize: String(pageSize) });
      if (source) qs.set('source', source);
      if (search) qs.set('search', search);
      return apiCall(`/scraped-roles?${qs.toString()}`);
    },
    sources:   ()    => apiCall('/scraped-roles/sources'),
    track:     (id)  => apiCall(`/scraped-roles/${id}/track`,      { method: 'POST', body: {} }),
    autoApply: (id)  => apiCall(`/scraped-roles/${id}/auto-apply`, { method: 'POST', body: {} }),
    refresh:   ()    => apiCall('/scraped-roles/refresh',          { method: 'POST', body: {} }),
  },

  companies: {
    list:         () => apiCall('/jobs'),
    categories:   () => apiCall('/companies/categories'),
    searchByName: (companyName) => apiCall('/companies/search-by-name', { method: 'POST', body: { companyName } }),
    // Scrapes write to the canonical `jobs` table used by the Companies grid.
    // Pass { source } for a single source, or omit it for all sources.
    scrape:       (params) => apiCall('/jobs/scrape', { method: 'POST', body: params }),
    // Back-compat only; ScraperPage uses jobs.scrape so per-source results
    // appear in the main Companies grid.
    scrapeSource: (src, params) => apiCall(`/companies/scrape/${encodeURIComponent(src)}`, { method: 'POST', body: params }),
  },

  yc: {
    companies:  (params = {}) => apiCall('/yc/companies' + qs({
      page:        params.page,
      pageSize:    params.pageSize,
      location:    params.location,
      industry:    params.industry,
      maxTeamSize: params.maxTeamSize,
      minTeamSize: params.minTeamSize,
      batch:       params.batch,
      q:           params.q || params.search,
    })),
    company:    (slug) => apiCall(`/yc/companies/${encodeURIComponent(slug)}`),
    import:     (slugs)   => apiCall('/yc/import',     { method: 'POST', body: { slugs } }),
    importAll:  (filters) => apiCall('/yc/import-all', { method: 'POST', body: { filters } }),
    scrapeWaas: () => apiCall('/yc/scrape-waas', { method: 'POST', body: {} }),
  },

  generate: {
    email:    (body) => apiCall('/generate/email',    { method: 'POST', body }),
    linkedin: (body) => apiCall('/generate/linkedin', { method: 'POST', body }),
    templates: () => apiCall('/generate/templates'),
    saveTemplates: (body) => apiCall('/generate/templates', { method: 'PUT', body }),
    both: async (body) => {
      const [emailRes, linkedinRes] = await Promise.all([
        apiCall('/generate/email',    { method: 'POST', body }),
        apiCall('/generate/linkedin', { method: 'POST', body }),
      ])
      return { email: emailRes.email, linkedin: linkedinRes.linkedin }
    },
    coverLetter: (body) => apiCall('/generate/email', { method: 'POST', body: { ...body, format: 'cover_letter' } }),
    waas:        (body) => apiCall('/generate/email', { method: 'POST', body: { ...body, format: 'waas_dm' } }),
  },

  unified: {
    categoryCounts: () => apiCall('/unified/category-counts'),
    companies:      (params = {}) => apiCall('/unified/companies' + qs({
      category: params.category,
      search:   params.search,
      source:   params.source,
      status:   params.status,
      sort:     params.sort,
      page:     params.page,
      pageSize: params.pageSize,
    })),
    dashboard:      () => apiCall('/unified/dashboard'),
    allContacts:    (params = {}) => apiCall('/unified/all-contacts' + (
      params instanceof URLSearchParams ? `?${params.toString()}` : qs(params)
    )),
  },

  jobs: {
    lastRefresh:  () => apiCall('/jobs/last-refresh'),
    search:       (q) => apiCall('/jobs/search' + qs({ q })),
    detail:       (id) => apiCall(`/jobs/${id}/detail`),
    roles:        (id) => apiCall(`/jobs/${id}/roles`),
    careersUrl:   (id) => apiCall(`/jobs/${id}/careers-url`),
    contacts:     (id) => apiCall(`/jobs/${id}/contacts`),
    scrapeRoles:  (id, roleType = 'intern') => apiCall(`/jobs/${id}/scrape-roles`, { method: 'POST', body: { roleType } }),
    scrape:       (params) => apiCall('/jobs/scrape', { method: 'POST', body: params }),
    updateStatus: (id, status) => apiCall(`/jobs/${id}/status`, { method: 'PUT', body: { status } }),
    updateUrl:    (id, url)    => apiCall(`/jobs/${id}/url`,    { method: 'PUT', body: { url } }),
    findLinkedIn: (id) => apiCall(`/jobs/${id}/find-linkedin`, { method: 'POST', body: {} }),
    findPeopleStream: (id) => withAuthQuery(apiUrl(`/jobs/${id}/find-people-stream`)),
    findEmails: (id, domain = null) => apiCall(`/jobs/${id}/find-emails`, {
      method: 'POST',
      body: domain ? { domain } : {},
    }),
    findEmailForContact: (contactId) => apiCall(`/jobs/contacts/${contactId}/find-email`, { method: 'POST', body: {} }),
    generate: (contactId, type = 'email', extraContext = '') => apiCall(`/jobs/contacts/${contactId}/generate`, {
      method: 'POST',
      body: { type, extraContext },
    }),
    updateContact: (contactId, data) => apiCall(`/jobs/contacts/${contactId}`, { method: 'PUT', body: data }),
    deleteContact: (contactId) => apiCall(`/jobs/contacts/${contactId}`, { method: 'DELETE' }),
    scrapeLinkedInCompany: (id, linkedinUrl) => apiCall(`/jobs/${id}/scrape-linkedin-company`, {
      method: 'POST',
      body: { linkedinUrl },
    }),
  },

  career: {
    // ── Resume (backend-owned upload + parse) ────────────────────────────────
    resume:       () => apiCall('/career/resume'),
    uploadResume: async (file) => {
      const fd = new FormData()
      fd.append('resume', file)
      try {
        const r = await apiCall('/career/resume', { method: 'POST', body: fd })
        return { success: true, ...r }
      } catch (err) {
        return { success: false, error: err.message }
      }
    },

    // ── Evaluate / evaluations history ───────────────────────────────────────
    evaluate:         (body) => apiCall('/career/evaluate',       { method: 'POST', body }),
    batchEvaluate:    (urls) => apiCall('/career/batch-evaluate', { method: 'POST', body: { urls } }),
    parseResume:      async (file) => {
      const fd = new FormData()
      fd.append('resume', file)
      return apiCall('/career/parse-resume', { method: 'POST', body: fd })
    },
    evaluations:      () => apiCall('/career/evaluations'),
    evaluation:       (id) => apiCall(`/career/evaluations/${id}`),
    deleteEvaluation: (id) => apiCall(`/career/evaluations/${id}`, { method: 'DELETE' }),

    // ── Apply-state ──────────────────────────────────────────────────────────
    setApplyStatus: (id, status) => apiCall(`/career/evaluations/${id}/apply-status`, { method: 'PATCH', body: { status } }),
    setApplyMode:   (id, mode)   => apiCall(`/career/evaluations/${id}/apply-mode`,   { method: 'PATCH', body: { mode } }),
    apply:          (id) => apiCall(`/career/evaluations/${id}/apply`,        { method: 'POST' }),
    markApplied:    (id) => apiCall(`/career/evaluations/${id}/mark-applied`, { method: 'POST' }),

    // ── Pipeline / tracker / stats / ranked ──────────────────────────────────
    pipeline:    () => apiCall('/career/pipeline'),
    tracker:     () => apiCall('/career/tracker'),
    stats:       () => apiCall('/career/stats'),
    ranked:      () => apiCall('/career/ranked'),
    scanPortals: (roleType = 'intern') => apiCall('/career/scan-portals', { method: 'POST', body: { roleType } }),
    autoApplyQueue:   () => apiCall('/career/auto-apply-queue'),
    nightlySettings:  () => apiCall('/career/nightly-settings'),
    saveNightlySettings: (body) => apiCall('/career/nightly-settings', { method: 'PUT', body }),
    autoQueueSettings:    () => apiCall('/career/auto-queue-settings'),
    saveAutoQueueSettings: (body) => apiCall('/career/auto-queue-settings', { method: 'PUT', body }),
    runNightlyPipeline:  (overrides = {}) => apiCall('/career/nightly-pipeline', { method: 'POST', body: overrides }),
    nightlyLastRun:      () => apiCall('/career/nightly-pipeline/last-run'),

    // ── Profile + resumes library ────────────────────────────────────────────
    profile:        () => apiCall('/career/profile'),
    updateProfile:  (profile) => apiCall('/career/profile', { method: 'PUT', body: profile }),
    exportData:     () => apiCall('/career/privacy/export'),
    eraseSensitiveProfile: (dryRun = false) => apiCall('/career/privacy/sensitive-profile' + (dryRun ? '?dryRun=true' : ''), { method: 'DELETE' }),
    resumesLibrary: () => apiCall('/career/resumes-library'),
    storageLibrary: () => apiCall('/career/library'),
    uploadLibrary:  async (archetype, file) => {
      const fd = new FormData()
      fd.append('archetype', archetype)
      fd.append('resume', file)
      return apiCall('/career/library/upload', { method: 'POST', body: fd })
    },
    deleteLibrary:  (archetype, filename) => apiCall(`/career/library/${encodeURIComponent(archetype)}/${encodeURIComponent(filename)}`, { method: 'DELETE' }),

    // ── Auto-apply on a company from /discover/companies ─────────────────────
    autoApplyCompanyQueue:          (companyId, body = {}) => apiCall(`/career/auto-apply-company/${companyId}/queue`,            { method: 'POST', body }),
    autoApplyCompanyScrapeAndQueue: (companyId, body = {}) => apiCall(`/career/auto-apply-company/${companyId}/scrape-and-queue`, { method: 'POST', body }),

    // Pick a resume for a per-company application from the user's storage library
    setCompanyResumeFromLibrary:    (companyId, archetype, filename) => apiCall(`/companies/${companyId}/career-ops/resume/from-library`, { method: 'POST', body: { archetype, filename } }),

    // ── Career-Ops company page ──────────────────────────────────────────────
    getCompany:    (id) => apiCall(`/career/company/${id}`),
    updateCompany: (id, patch) => apiCall(`/career/company/${id}`, { method: 'PUT', body: patch }),
    scoreFit:      (id) => apiCall(`/career/company/${id}/score-fit`, { method: 'POST' }),
    scoreFitUrl:   (id) => withAuthQuery(apiUrl(`/career/company/${id}/score-fit`)),

    // ── Auto-apply ───────────────────────────────────────────────────────────
    autoApplyRun:           (body = {}) => apiCall('/career/auto-apply/run', { method: 'POST', body }),
    autoApplyDirect:        (body) => apiCall('/career/auto-apply-direct',        { method: 'POST', body }),
    autoApplyResumePreview: (jobUrls) => apiCall('/career/auto-apply/resume-preview', { method: 'POST', body: { jobUrls } }),

    // ── Bulk queue (slider in Auto Apply → Queue tab) ────────────────────────
    bulkQueuePreview: (params) => apiCall('/career/bulk-queue/preview' + (
      params instanceof URLSearchParams ? `?${params.toString()}` : (
        params && Object.entries(params).some(([, v]) => v !== '' && v != null)
          ? '?' + new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v != null))).toString()
          : ''
      )
    )),
    bulkQueue:        (body) => apiCall('/career/bulk-queue', { method: 'POST', body }),
    queueByIds:       (ids)  => apiCall('/career/queue-by-ids', { method: 'POST', body: { ids } }),

    // ── Company documents ────────────────────────────────────────────────────
    documents:        (companyId) => apiCall(`/career/${companyId}/documents`),
    uploadDocument:   async (companyId, file) => {
      const fd = new FormData()
      fd.append('file', file)
      return apiCall(`/career/${companyId}/documents`, { method: 'POST', body: fd })
    },
    deleteDocument:   (companyId, docId) => apiCall(`/career/${companyId}/documents/${docId}`, { method: 'DELETE' }),
    downloadDocument: (companyId, docId, filename) =>
      downloadAuthenticatedFile(`/career/${companyId}/documents/${docId}/download`, filename),

    // ── Report / download — fetched with Bearer auth and opened as a blob URL,
    //    so the JWT never appears in URLs, history, or referrers.
    openReportTab:        (id) => openAuthenticatedTab(`/career/evaluations/${id}/report.html`),
    downloadEvaluationPdf: (id, filename) => downloadAuthenticatedFile(`/career/download/${id}`, filename),
    tailoredResume: (id) => apiCall(`/career/tailored-resume/${id}`, { method: 'POST' }),
    // Upload a custom resume PDF for a specific evaluation. Backend writes
    // evaluations.pdf_path, which autoApplier honors over library matching.
    uploadEvalResume: async (id, file) => {
      const fd = new FormData()
      fd.append('resume', file)
      return apiCall(`/career/upload-resume/${id}`, { method: 'POST', body: fd })
    },
  },

  automations: {
    linkedinFinder:  (body) => apiCall('/automations/linkedin-finder', { method: 'POST', body }),
    aiSearch:        (body) => apiCall('/automations/ai-search',       { method: 'POST', body }),
    autoApply:       (body) => apiCall('/automations/auto-apply',      { method: 'POST', body }),
    logs:            (id)   => apiCall(`/automations/logs/${id}`),
    scheduled:       () => apiCall('/automations/scheduled'),
    addScheduled:    (body) => apiCall('/automations/scheduled', { method: 'POST', body }),
    deleteScheduled: (id)   => apiCall(`/automations/scheduled/${id}`, { method: 'DELETE' }),
  },
}
