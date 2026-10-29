// ── Paid-provider guard: typed errors + "out of quota, stop calling" ─────────
//
// Hunter, Prospeo, Apollo and Serper used to swallow failures and return
// empty results, so an exhausted quota looked like "0 found" and every click
// kept spending calls. Providers now throw ProviderError with a code; QUOTA /
// AUTH / RATE_LIMIT trip a per-provider cooldown and the reason is shown to
// the user instead of a silent zero.

export class ProviderError extends Error {
  /** @param {'QUOTA'|'PLAN'|'AUTH'|'RATE_LIMIT'|'CONFIG'|'SKIPPED'|'HTTP'|'NETWORK'} code */
  constructor(provider, code, message, { status = null, retryAt = null } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.provider = provider;
    this.code = code;
    this.status = status;
    this.retryAt = retryAt;
  }
}

const COOLDOWN_MS = { QUOTA: 60 * 60_000, PLAN: 24 * 60 * 60_000, AUTH: 60 * 60_000, RATE_LIMIT: 2 * 60_000 };
const cooldowns = new Map(); // provider → { until, code, message }

const PROVIDER_LABEL = { hunter: 'Hunter', prospeo: 'Prospeo', apollo: 'Apollo', serper: 'Serper' };

/** Map an HTTP status (+ body text) to a ProviderError. */
export function errorFromHttp(provider, status, bodyText = '') {
  const label = PROVIDER_LABEL[provider] || provider;
  const body = String(bodyText || '').slice(0, 200);
  if (status === 401) return new ProviderError(provider, 'AUTH', `${label} rejected the API key`, { status });
  // Apollo's Free plan: the key works, but its API lookups need a paid plan.
  if (/not included in your \w+ plan|API_INACCESSIBLE/i.test(body)) {
    return new ProviderError(provider, 'PLAN', `${label}'s Free plan doesn't include API lookups`, { status });
  }
  if (status === 402 || /quota|credit|limit reached|usage limit|insufficient|plan/i.test(body) && status !== 404) {
    return new ProviderError(provider, 'QUOTA', `${label} is out of credits for this month`, { status });
  }
  if (status === 403) return new ProviderError(provider, 'AUTH', `${label} plan doesn't include this lookup`, { status });
  if (status === 429) return new ProviderError(provider, 'RATE_LIMIT', `${label} is rate-limiting us — try again in a couple of minutes`, { status });
  return new ProviderError(provider, 'HTTP', `${label} error (HTTP ${status})${body ? `: ${body}` : ''}`, { status });
}

export function markCooldown(err) {
  const ms = COOLDOWN_MS[err?.code];
  if (!ms || !err.provider) return;
  cooldowns.set(err.provider, { until: Date.now() + ms, code: err.code, message: err.message });
}

/** Throws SKIPPED if the provider is cooling down after a quota/auth/rate error. */
export function assertAvailable(provider) {
  const c = cooldowns.get(provider);
  if (!c) return;
  if (Date.now() >= c.until) { cooldowns.delete(provider); return; }
  throw new ProviderError(provider, 'SKIPPED', c.message, { retryAt: new Date(c.until).toISOString() });
}

export function providerStatus(provider) {
  const c = cooldowns.get(provider);
  return c && Date.now() < c.until ? { available: false, ...c, until: new Date(c.until).toISOString() } : { available: true };
}

/** Test hook. */
export function resetCooldowns() { cooldowns.clear(); }

/**
 * Run a provider call: skip while cooling down, normalise any thrown error
 * into a ProviderError and start a cooldown when it's quota/auth/rate.
 */
export async function guarded(provider, fn) {
  assertAvailable(provider);
  try {
    return await fn();
  } catch (err) {
    let pe = err;
    if (!(err instanceof ProviderError)) {
      const status = err?.response?.status;
      if (status) pe = errorFromHttp(provider, status, JSON.stringify(err.response?.data ?? ''));
      else if (err?.name === 'TimeoutError' || err?.code === 'ECONNABORTED' || /timeout/i.test(err?.message || '')) {
        pe = new ProviderError(provider, 'NETWORK', `${PROVIDER_LABEL[provider] || provider} timed out`);
      } else {
        pe = new ProviderError(provider, 'NETWORK', `${PROVIDER_LABEL[provider] || provider}: ${err?.message || 'request failed'}`);
      }
    }
    markCooldown(pe);
    throw pe;
  }
}

/** Compact, user-facing reason list for API responses. */
export function toReason(err) {
  if (err instanceof ProviderError) return { provider: err.provider, code: err.code, message: err.message, ...(err.retryAt ? { retryAt: err.retryAt } : {}) };
  return { provider: 'unknown', code: 'ERROR', message: err?.message || String(err) };
}
