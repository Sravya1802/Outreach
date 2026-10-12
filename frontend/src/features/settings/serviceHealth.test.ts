import { describe, expect, it } from 'vitest'
import type { Credits, Health } from '@/lib/api'
import { overallHealth, serviceStatuses } from './serviceHealth'

const health: Health = {
  status: 'ok', ai_provider: 'openai', has_gemini: true, has_openai: true, has_apify: true, has_apollo: true,
  has_serper: true, has_hunter: true, has_prospeo: true, has_linkedin: false, auth_mode: 'enforce', nightly_cron_disabled: false,
}

function byId(list: ReturnType<typeof serviceStatuses>, id: string) {
  const found = list.find(s => s.id === id)
  if (!found) throw new Error(`no service ${id}`)
  return found
}

describe('serviceStatuses', () => {
  it('marks unconfigured services off and names the AI provider', () => {
    const list = serviceStatuses(health, {})
    expect(byId(list, 'linkedin').state).toBe('off')
    expect(byId(list, 'ai').name).toBe('OpenAI')
    expect(byId(list, 'ai').state).toBe('ok')
  })

  it('surfaces quota problems', () => {
    const credits: Credits = {
      apify: { configured: true, usedUsd: 5, limitUsd: 5, balanceUsd: 0, critical: true },
      hunter: { configured: true, used: 45, available: 5, total: 50, warning: true },
      gemini: { configured: true, rateLimited: true },
    }
    const list = serviceStatuses(health, credits)
    expect(byId(list, 'apify').state).toBe('down')
    expect(byId(list, 'hunter').state).toBe('warn')
    expect(byId(list, 'ai').state).toBe('warn')
  })

  it('prefers an explicit error message', () => {
    const list = serviceStatuses(health, { apify: { configured: true, usedUsd: 0, limitUsd: 5, balanceUsd: 5, error: 'Monthly usage hard limit exceeded' } })
    expect(byId(list, 'apify')).toMatchObject({ state: 'down', note: 'Monthly usage hard limit exceeded' })
  })

  it('only adds a note when it says something the badge does not', () => {
    expect(byId(serviceStatuses(health, {}), 'apollo').note).toBe('')
  })

  it('formats usage notes when healthy', () => {
    const list = serviceStatuses(health, { apify: { configured: true, usedUsd: 1.5, limitUsd: 5, balanceUsd: 3.5 } })
    expect(byId(list, 'apify').note).toBe('$1.50 of $5.00 used this month')
  })

  it('treats missing health as everything off', () => {
    expect(serviceStatuses(undefined, undefined).every(s => s.state === 'off')).toBe(true)
  })
})

describe('overallHealth', () => {
  it('reports ok, single and multiple problems', () => {
    expect(overallHealth(serviceStatuses(health, {})).state).toBe('ok')
    const one = overallHealth(serviceStatuses(health, { apify: { configured: true, usedUsd: 5, limitUsd: 5, balanceUsd: 0, critical: true } }))
    expect(one).toEqual({ state: 'down', label: 'Apify unavailable' })
    const two = overallHealth(serviceStatuses(health, {
      apify: { configured: true, usedUsd: 5, limitUsd: 5, balanceUsd: 0, critical: true },
      apollo: { configured: true, working: false },
    }))
    expect(two.label).toBe('2 services unavailable')
  })
})
