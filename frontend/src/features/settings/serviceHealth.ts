import type { Credits, Health } from '@/lib/api'

export type ServiceState = 'ok' | 'warn' | 'down' | 'off'

export interface ServiceStatus {
  id: string
  name: string
  purpose: string
  state: ServiceState
  note: string
}

interface Flags { configured?: boolean; warning?: boolean; critical?: boolean; error?: string; rateLimited?: boolean; working?: boolean }

const PROVIDER_NAMES: Record<string, string> = { openai: 'OpenAI', gemini: 'Gemini', anthropic: 'Claude' }

/** okNote is shown only when it adds something beyond the "Working" badge. */
function judge(configured: boolean, flags: Flags | undefined, okNote = ''): { state: ServiceState; note: string } {
  if (!configured) return { state: 'off', note: 'Not configured' }
  if (flags?.error) return { state: 'down', note: flags.error }
  if (flags?.critical) return { state: 'down', note: 'Quota exhausted' }
  if (flags?.working === false) return { state: 'down', note: 'Not responding' }
  if (flags?.rateLimited) return { state: 'warn', note: 'Rate limited — retrying later' }
  if (flags?.warning) return { state: 'warn', note: 'Running low on quota' }
  return { state: 'ok', note: okNote }
}

/** Merge /health (is it configured?) with /credits/status (is it actually usable?). */
export function serviceStatuses(health: Health | undefined, credits: Credits | undefined): ServiceStatus[] {
  const h = health
  const c = credits ?? {}
  const aiConfigured = Boolean(h?.has_gemini || h?.has_openai)
  const provider = (h?.ai_provider && PROVIDER_NAMES[h.ai_provider.toLowerCase()]) || 'AI provider'

  const apifyNote = c.apify && c.apify.limitUsd > 0
    ? `$${c.apify.usedUsd.toFixed(2)} of $${c.apify.limitUsd.toFixed(2)} used this month`
    : ''
  const hunterNote = c.hunter ? `${c.hunter.available} of ${c.hunter.total} lookups left` : ''

  return [
    { id: 'ai', name: provider, purpose: 'Role evaluation & message writing', ...judge(aiConfigured, c.gemini) },
    { id: 'apify', name: 'Apify', purpose: 'LinkedIn people search', ...judge(Boolean(h?.has_apify), c.apify, apifyNote) },
    { id: 'apollo', name: 'Apollo', purpose: 'Finding people at companies', ...judge(Boolean(h?.has_apollo), c.apollo) },
    { id: 'hunter', name: 'Hunter', purpose: 'Email lookup', ...judge(Boolean(h?.has_hunter), c.hunter, hunterNote) },
    { id: 'prospeo', name: 'Prospeo', purpose: 'Email lookup fallback', ...judge(Boolean(h?.has_prospeo), c.prospeo) },
    { id: 'serper', name: 'Serper', purpose: 'Google search for careers pages', ...judge(Boolean(h?.has_serper), undefined) },
    { id: 'linkedin', name: 'LinkedIn session', purpose: 'LinkedIn people search', ...judge(Boolean(h?.has_linkedin), undefined) },
  ]
}

/** One-line rollup for the sidebar. Ignores services that were never configured. */
export function overallHealth(list: ServiceStatus[]): { state: ServiceState; label: string } {
  const down = list.filter(s => s.state === 'down')
  const warn = list.filter(s => s.state === 'warn')
  if (down.length) return { state: 'down', label: down.length === 1 && down[0] ? `${down[0].name} unavailable` : `${down.length} services unavailable` }
  if (warn.length) return { state: 'warn', label: warn.length === 1 && warn[0] ? `${warn[0].name} needs attention` : `${warn.length} services need attention` }
  return { state: 'ok', label: 'All services OK' }
}
