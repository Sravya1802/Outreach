// ── Shared-key protection: per-user budgets + shared domain cache ────────────
// All accounts share one Hunter / Prospeo / Apollo / Serper key. Two guards:
//   • spend(): a per-user monthly call budget (env-tunable), so one account
//     can't burn the month's credits for everyone;
//   • cachedDomainSearch(): company-wide email lists are the same for every
//     user, so a domain search is cached for CACHE_DAYS and reused by all.
import { ProviderError } from './providerGuard.js';

// Defaults match the free accounts: Hunter 50 searches + 100 verifications, Prospeo 100, Serper (one-time credits).
const DEFAULT_MONTHLY_LIMITS = { hunter: 50, hunter_verify: 100, prospeo: 100, apollo: 40, serper: 300 };
export const CACHE_DAYS = 14;

export function monthlyLimit(provider) {
  const env = Number(process.env[`${provider.toUpperCase()}_USER_MONTHLY_LIMIT`]);
  return Number.isFinite(env) && env > 0 ? env : (DEFAULT_MONTHLY_LIMITS[provider] ?? 50);
}

export function currentMonth(now = new Date()) {
  return now.toISOString().slice(0, 7);
}

async function defaultDb() {
  const { one, all, run } = await import('../db.js');
  return { one, all, run };
}

/**
 * Reserve one call of `provider` for `userId` this month, or throw
 * ProviderError('BUDGET'). Atomic: the increment only happens while under
 * the limit, so concurrent requests can't overshoot.
 */
export async function spend(userId, provider, { db, now = new Date() } = {}) {
  if (!userId) return;
  const d = db || await defaultDb();
  const limit = monthlyLimit(provider);
  const row = await d.one(
    `INSERT INTO provider_usage (user_id, provider, month, calls) VALUES ($1, $2, $3, 1)
     ON CONFLICT (user_id, provider, month) DO UPDATE SET calls = provider_usage.calls + 1
       WHERE provider_usage.calls < $4
     RETURNING calls`,
    [userId, provider, currentMonth(now), limit],
  );
  if (!row) {
    const label = { hunter: 'Hunter', hunter_verify: 'Hunter email check', prospeo: 'Prospeo', apollo: 'Apollo', serper: 'Serper' }[provider] || provider;
    throw new ProviderError(provider, 'BUDGET', `You've used your ${limit} ${label} lookups for this month — resets on the 1st`);
  }
}

/** Calls used this month per provider, for display. */
export async function usageThisMonth(userId, { db, now = new Date() } = {}) {
  const d = db || await defaultDb();
  const rows = await d.all('SELECT provider, calls FROM provider_usage WHERE user_id = $1 AND month = $2', [userId, currentMonth(now)]);
  const out = {};
  for (const p of Object.keys(DEFAULT_MONTHLY_LIMITS)) {
    out[p] = { used: rows.find(r => r.provider === p)?.calls || 0, limit: monthlyLimit(p) };
  }
  return out;
}

/**
 * Domain search through the shared cache. `fetchFresh` is only called (and a
 * budget unit only spent) when there's no result younger than CACHE_DAYS.
 * @returns {Promise<{ result: any, cached: boolean }>}
 */
export async function cachedDomainSearch(provider, domain, fetchFresh, { userId, db, now = new Date() } = {}) {
  const d = db || await defaultDb();
  const hit = await d.one(
    'SELECT result, searched_at FROM provider_domain_cache WHERE provider = $1 AND domain = $2',
    [provider, domain],
  );
  if (hit && now.getTime() - new Date(hit.searched_at).getTime() < CACHE_DAYS * 86_400_000) {
    return { result: hit.result, cached: true };
  }
  await spend(userId, provider, { db: d, now });
  const result = await fetchFresh();
  await d.run(
    `INSERT INTO provider_domain_cache (provider, domain, result, searched_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT (provider, domain) DO UPDATE SET result = EXCLUDED.result, searched_at = EXCLUDED.searched_at`,
    [provider, domain, JSON.stringify(result), now.toISOString()],
  );
  return { result, cached: false };
}
