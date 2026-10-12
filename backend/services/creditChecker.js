/**
 * Checks remaining credits/quota for each API service.
 * Results are cached for 30 minutes to avoid hammering APIs on every request.
 */

import { getApifyQuotaBurn } from './apify.js';

// Cache: { result, fetchedAt }
let cache = null;
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// Track Gemini rate limit state (set by ai.js on 429)
let geminiRateLimited = false;
let geminiRateLimitedAt = null;

export function setGeminiRateLimited(limited) {
  geminiRateLimited = limited;
  geminiRateLimitedAt = limited ? new Date().toISOString() : null;
}

export function isGeminiRateLimited() { return geminiRateLimited; }

async function checkHunter() {
  const key = (process.env.HUNTER_API_KEY || '').trim();
  if (!key || key.length < 10) return { configured: false };
  try {
    const res = await fetch(`https://api.hunter.io/v2/account?api_key=${key}`, { signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    const searches = data?.data?.requests?.searches;
    if (!searches) return { configured: true, error: 'Could not read quota' };
    const used = searches.used || 0;
    const available = searches.available || 0;
    const total = used + available;
    return {
      configured: true,
      used, available, total,
      warning: available < 5,
      critical: available === 0,
      resetDate: data?.data?.reset_date || null,
    };
  } catch (err) {
    return { configured: true, error: err.message };
  }
}

async function checkApify() {
  const token = (process.env.APIFY_API_TOKEN || '').trim();
  if (!token || token.length < 10) return { configured: false };
  try {
    // /users/me/limits is the only endpoint that reports real monthly spend
    // against the hard cap — /users/me has no usage fields, so it read as $0.
    const limitsRes = await fetch(`https://api.apify.com/v2/users/me/limits?token=${token}`, { signal: AbortSignal.timeout(8000) });
    const limitsData = await limitsRes.json().catch(() => null);
    const limits = limitsData?.data;
    if (limitsRes.ok && limits?.limits?.maxMonthlyUsageUsd != null) {
      const limitUsd = Number(limits.limits.maxMonthlyUsageUsd) || 0;
      const usageUsd = Number(limits.current?.monthlyUsageUsd) || 0;
      const balanceUsd = Math.max(0, limitUsd - usageUsd);
      const resetDate = limits.monthlyUsageCycle?.endAt || null;
      const exhausted = limitUsd > 0 && usageUsd >= limitUsd;
      return {
        configured: true,
        usedUsd: usageUsd,
        limitUsd,
        balanceUsd,
        resetDate,
        warning: balanceUsd < Math.max(0.50, limitUsd * 0.1),
        critical: balanceUsd < 0.05 || exhausted,
        ...(exhausted ? { error: `Monthly limit reached ($${usageUsd.toFixed(2)} of $${limitUsd.toFixed(2)})${resetDate ? ` — resets ${resetDate.slice(0, 10)}` : ''}` } : {}),
      };
    }

    const res = await fetch(`https://api.apify.com/v2/users/me?token=${token}`, { signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    if (!res.ok) {
      const message = data?.error?.message || data?.message || `Apify HTTP ${res.status}`;
      return {
        configured: true,
        error: message,
        warning: true,
        critical: /limit|quota|exhaust|insufficient|payment|billing|forbidden|unauthor/i.test(message) || [401, 402, 403, 429].includes(res.status),
      };
    }

    const user = data?.data || {};
    const plan = user.plan || {};
    const billing = user.currentBillingPeriod || user.billing || {};
    const usageUsd = Number(
      billing.usageUsd ??
      billing.usedUsd ??
      user.usageUsd ??
      (billing.usageUsdCents != null ? billing.usageUsdCents / 100 : null) ??
      (plan.usageUsdCents != null ? plan.usageUsdCents / 100 : null) ??
      0
    );
    const limitUsd = Number(
      billing.usageLimitUsd ??
      billing.limitUsd ??
      plan.usageLimitUsd ??
      plan.monthlyUsageLimitUsd ??
      plan.monthlyUsageUsd ??
      5
    );
    const balanceUsd = Math.max(0, limitUsd - usageUsd);
    return {
      configured: true,
      usedUsd: usageUsd,
      limitUsd,
      balanceUsd,
      warning: balanceUsd < Math.max(0.50, limitUsd * 0.1),
      critical: balanceUsd < 0.05 || usageUsd >= limitUsd,
    };
  } catch (err) {
    return { configured: true, error: err.message, warning: true, critical: true };
  }
}

async function checkApollo() {
  const key = (process.env.APOLLO_API_KEY || '').trim();
  if (!key || key === 'your_apollo_key_here' || key.length < 5) return { configured: false };
  try {
    // Apollo doesn't have a simple credits endpoint on free tier
    // Just verify the key works
    const res = await fetch('https://api.apollo.io/v1/auth/health', {
      headers: { 'X-Api-Key': key },
      signal: AbortSignal.timeout(8000),
    });
    return {
      configured: true,
      working: res.ok,
      warning: !res.ok,
      critical: !res.ok,
    };
  } catch (err) {
    return { configured: true, error: err.message };
  }
}

async function checkProspeo() {
  const key = (process.env.PROSPEO_API_KEY || '').trim();
  if (!key || key === 'your_prospeo_api_key' || key.length < 5) return { configured: false };
  // Prospeo doesn't have a public quota endpoint — just mark as configured
  return { configured: true, working: true };
}

// Apify's /v2/users/me account view doesn't expose actor-side monthly limits,
// so a "Monthly usage hard limit exceeded" burn looks fine in checkApify() —
// the green dot in the sidebar lies. apify.js exports a sentinel that's bumped
// every time an actor call throws a quota-shaped error; we overlay it on top
// of (or in lieu of) the cached result so the sidebar flips red within seconds
// of the next failed scrape, regardless of the 30-min cache.
function applyApifyBurn(apify) {
  const burn = getApifyQuotaBurn();
  if (!burn?.recent) return apify;
  const base = apify || { configured: true };
  return {
    ...base,
    warning: true,
    critical: true,
    burn: {
      lastError:  burn.lastError,
      lastActor:  burn.lastActor,
      ageMinutes: Math.round(burn.ageMs / 60000),
    },
    error: base.error || `Apify actor failed with quota error: ${burn.lastError}`,
  };
}

export async function checkAllCredits(forceRefresh = false) {
  if (!forceRefresh && cache && Date.now() - cache.fetchedAt < CACHE_TTL) {
    // Re-evaluate Apify burn on every read — the sentinel is in-memory and free.
    const burnedApify = applyApifyBurn(cache.result.apify);
    if (burnedApify !== cache.result.apify) {
      return {
        ...cache.result,
        apify: burnedApify,
        hasWarnings: true,
      };
    }
    return cache.result;
  }

  const [hunter, apify, apollo, prospeo] = await Promise.allSettled([
    checkHunter(),
    checkApify(),
    checkApollo(),
    checkProspeo(),
  ]);

  const gemini = {
    configured: !!(process.env.GEMINI_API_KEY),
    rateLimited: geminiRateLimited,
    rateLimitedAt: geminiRateLimitedAt,
    warning: geminiRateLimited,
    critical: false,
  };

  const apifyResult = applyApifyBurn(apify.value || { configured: false, error: apify.reason?.message });

  const result = {
    hunter:  hunter.value  || { configured: false, error: hunter.reason?.message },
    apify:   apifyResult,
    apollo:  apollo.value  || { configured: false, error: apollo.reason?.message },
    prospeo: prospeo.value || { configured: false, error: prospeo.reason?.message },
    gemini,
    checkedAt: new Date().toISOString(),
    hasWarnings: [hunter.value, apifyResult, apollo.value, gemini].some(s => s?.warning || s?.critical),
  };

  cache = { result, fetchedAt: Date.now() };
  return result;
}

export function invalidateCache() { cache = null; }
