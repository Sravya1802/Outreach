// One door for every AI call: routes each task to its model, meters the real
// cost of every call in ai_usage, and refuses calls once a monthly budget is
// spent (a hard cap on top of the limits set in each provider's console).
//
//   score, evaluate, email, categorize → Groq gpt-oss (OpenAI as backup)
//   keywords (ATS terms from a JD)      → Groq, so the resume writer never grades itself
//   keywords and evaluate also fall back to Gemini Flash, so one provider's
//   daily limit never blocks a resume
//   resume, resume_parse, cover_letter → Claude Opus 5.5 only. If it's down
//                                        the caller waits and retries; resume
//                                        quality is never quietly downgraded.
import OpenAI from 'openai';
import { all, one, run } from '../db.js';
import { claudeMessage, hasClaudeKey, claudeBatchSubmit, claudeBatchStatus, claudeBatchResults } from './claude.js';
import { currentUserId } from './requestContext.js';

// USD per 1M tokens: [input, cached input, output]. Rounded up where sources
// disagree, so the cap trips early rather than late.
export const PRICES = {
  'groq:openai/gpt-oss-120b': [0.15, 0.075, 0.60],
  'groq:openai/gpt-oss-20b': [0.10, 0.05, 0.50],
  'openai:gpt-4o-mini': [0.15, 0.075, 0.60],
  // Not yet on Google's price page when added; set high (Gemini 3 Flash ×1.5) so the cap trips early.
  'gemini:gemini-3.8-flash': [0.75, 0.19, 4.50],
  'openai:gpt-4o': [2.50, 1.25, 10.00],
  'anthropic:claude-opus-5-5': [4.00, 0.40, 20.00],
};

export const ROUTES = {
  score: [{ provider: 'groq', model: 'openai/gpt-oss-120b', reasoning: 'low' }, { provider: 'openai', model: 'gpt-4o-mini' }],
  evaluate: [{ provider: 'groq', model: 'openai/gpt-oss-120b', reasoning: 'medium' }, { provider: 'gemini', model: 'gemini-3.8-flash', reasoning: 'medium' }, { provider: 'openai', model: 'gpt-4o-mini' }],
  email: [{ provider: 'groq', model: 'openai/gpt-oss-120b', reasoning: 'low' }, { provider: 'openai', model: 'gpt-4o-mini' }],
  categorize: [{ provider: 'groq', model: 'openai/gpt-oss-20b', reasoning: 'low' }, { provider: 'openai', model: 'gpt-4o-mini' }],
  keywords: [{ provider: 'groq', model: 'openai/gpt-oss-120b', reasoning: 'low' }, { provider: 'gemini', model: 'gemini-3.8-flash', reasoning: 'low' }, { provider: 'openai', model: 'gpt-4o-mini' }],
  // Medium effort: high thought for ~12K output tokens a draft (~$0.30); medium is about half.
  resume: [{ provider: 'anthropic', model: 'claude-opus-5-5', effort: process.env.RESUME_EFFORT || 'medium' }],
  resume_parse: [{ provider: 'anthropic', model: 'claude-opus-5-5', effort: 'low' }],
  cover_letter: [{ provider: 'anthropic', model: 'claude-opus-5-5', effort: 'medium' }],
};

export class BudgetExceededError extends Error {
  constructor(scope, spent, cap) {
    super(scope === 'user'
      ? `You’ve used this month’s AI budget ($${spent.toFixed(2)} of $${cap.toFixed(2)}). It resets on the 1st.`
      : `The site’s AI budget for this month is used up ($${spent.toFixed(2)} of $${cap.toFixed(2)}). It resets on the 1st.`);
    this.name = 'BudgetExceededError';
    this.status = 402;
    this.scope = scope;
  }
}

export function caps(env = process.env) {
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  return { site: num(env.AI_MONTHLY_CAP_USD, 40), user: num(env.AI_USER_MONTHLY_CAP_USD, 30) };
}

export function costOf(key, { input = 0, cachedInput = 0, output = 0 }) {
  const p = PRICES[key];
  if (!p) return 0;
  return (input * p[0] + cachedInput * p[1] + output * p[2]) / 1_000_000;
}

/** Worst-case cost of a call before it runs (≈4 characters per token). */
export function estimateCost(key, { system = '', user = '', maxTokens = 4000 }) {
  return costOf(key, { input: Math.ceil((system.length + user.length) / 4), output: maxTokens });
}

const monthStart = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString(); };

async function spentThisMonth(userId) {
  const r = await one(
    `SELECT COALESCE(SUM(cost_usd), 0)::float AS site,
            COALESCE(SUM(cost_usd) FILTER (WHERE user_id = $2), 0)::float AS mine
       FROM ai_usage WHERE created_at >= $1`,
    [monthStart(), userId],
  );
  return { site: r?.site ?? 0, mine: r?.mine ?? 0 };
}

/** Throws BudgetExceededError if this call could push either budget over its cap. */
export async function assertBudget(userId, estimate) {
  const c = caps();
  const s = await spentThisMonth(userId);
  if (s.site + estimate > c.site) throw new BudgetExceededError('site', s.site, c.site);
  if (userId && s.mine + estimate > c.user) throw new BudgetExceededError('user', s.mine, c.user);
}

async function record({ userId, task, provider, model, usage, ok, error }) {
  const cost = ok ? costOf(`${provider}:${model}`, usage) : 0;
  await run(
    `INSERT INTO ai_usage (user_id, task, provider, model, input_tokens, cached_input_tokens, output_tokens, cost_usd, ok, error)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [userId, task, provider, model, usage?.input || 0, usage?.cachedInput || 0, usage?.output || 0, cost, ok, error ? String(error).slice(0, 300) : null],
  ).catch(err => console.warn('[llm] usage not recorded:', err.message));
  return cost;
}

const clients = {};
const BASE_URLS = { groq: 'https://api.groq.com/openai/v1', gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/' };
const KEYS = { groq: 'GROQ_API_KEY', gemini: 'GEMINI_API_KEY', openai: 'OPENAI_API_KEY' };
function openaiCompatible(provider) {
  const key = process.env[KEYS[provider]];
  if (!key || key === 'your_gemini_key_here') return null;
  const id = `${provider}:${key.slice(-6)}`;
  if (!clients[id]) {
    clients[id] = new OpenAI({
      apiKey: key,
      ...(BASE_URLS[provider] ? { baseURL: BASE_URLS[provider] } : {}),
      timeout: 120_000,
      maxRetries: 2,
    });
  }
  return clients[id];
}

/** Milliseconds a 429 asks us to wait, or null if it isn't a rate limit. */
export function rateLimitWait(err) {
  if (Number(err?.status) !== 429 && !/rate limit/i.test(String(err?.message))) return null;
  if (/no credits|quota|billing/i.test(String(err?.message))) return null;
  const m = /try again in (?:(\d+)m)?([\d.]+)s/i.exec(String(err?.message));
  const secs = m ? Number(m[1] || 0) * 60 + Number(m[2]) : Number(err?.headers?.get?.('retry-after')) || 20;
  // A daily limit ("try again in 33m") isn't worth waiting for: fail now, the caller retries later.
  if (secs > 60 || /per day|TPD|RPD/i.test(String(err?.message))) return null;
  return Math.max(1, secs + 1) * 1000;
}

function available(step) {
  if (step.provider === 'anthropic') return hasClaudeKey();
  return Boolean(openaiCompatible(step.provider));
}

async function callStep(step, { system, user, json, schema, maxTokens, timeoutMs }) {
  if (step.provider === 'anthropic') {
    const r = await claudeMessage({ system, user, effort: step.effort, maxTokens, schema, cacheSystem: Boolean(system && system.length > 4000), timeoutMs });
    return { text: r.text, usage: r.usage };
  }
  const client = openaiCompatible(step.provider);
  const body = {
    model: step.model,
    messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: user }],
    max_completion_tokens: maxTokens,
    ...(json || schema ? { response_format: { type: 'json_object' } } : {}),
    ...(step.reasoning && step.provider !== 'openai' ? { reasoning_effort: step.reasoning } : {}),
  };
  // Groq's per-minute limits ask for waits the SDK's short retries don't cover:
  // wait as long as it says ("try again in 12.3s"), up to a minute, three times.
  let res;
  for (let attempt = 0; ; attempt += 1) {
    try {
      res = await client.chat.completions.create(body, timeoutMs ? { timeout: timeoutMs } : undefined);
      break;
    } catch (err) {
      const wait = rateLimitWait(err);
      if (step.provider !== 'groq' || wait == null || attempt >= 2) throw err;
      await new Promise(r => setTimeout(r, wait));
    }
  }
  const text = res.choices?.[0]?.message?.content?.trim() || '';
  if (!text) throw new Error(`${step.provider} returned no text (finish_reason: ${res.choices?.[0]?.finish_reason})`);
  const u = res.usage || {};
  const cached = u.prompt_tokens_details?.cached_tokens || 0;
  return { text, usage: { input: (u.prompt_tokens || 0) - cached, cachedInput: cached, output: u.completion_tokens || 0 } };
}

/**
 * Run one AI task. Returns { text, provider, model, costUsd }.
 * `schema` (a JSON schema) makes Claude's reply follow it exactly; other
 * providers get JSON mode and the caller validates.
 * @param {{ task: keyof ROUTES, system?: string, user: string, json?: boolean, schema?: object, maxTokens?: number, timeoutMs?: number, userId?: string }} p
 */
export async function complete({ task, system = '', user, json = false, schema, maxTokens = 4000, timeoutMs, userId = currentUserId() }) {
  const route = ROUTES[task];
  if (!route) throw new Error(`Unknown AI task: ${task}`);
  const steps = route.filter(available);
  if (!steps.length) {
    throw Object.assign(new Error(['resume', 'resume_parse', 'cover_letter'].includes(task)
      ? 'Resume writing needs the Claude API key, which isn’t set on the server.'
      : 'No AI provider key is set on the server.'), { status: 503 });
  }
  const errors = [];
  for (const step of steps) {
    const key = `${step.provider}:${step.model}`;
    await assertBudget(userId, estimateCost(key, { system, user, maxTokens }));
    try {
      const r = await callStep(step, { system, user, json, schema, maxTokens, timeoutMs });
      const costUsd = await record({ userId, task, provider: step.provider, model: step.model, usage: r.usage, ok: true });
      return { text: r.text, provider: step.provider, model: step.model, costUsd };
    } catch (err) {
      await record({ userId, task, provider: step.provider, model: step.model, usage: null, ok: false, error: err.message });
      errors.push(`${step.provider}: ${String(err.message).slice(0, 120)}`);
    }
  }
  throw Object.assign(new Error(`AI ${task} failed: ${errors.join(' | ')}`), { status: 502 });
}

/** This month's spend for the Settings page. */
export async function usageSummary(userId) {
  const since = monthStart();
  const [s, byTask] = await Promise.all([
    spentThisMonth(userId),
    all(
      `SELECT task, COUNT(*) FILTER (WHERE ok)::int AS calls, COALESCE(SUM(cost_usd), 0)::float AS cost
         FROM ai_usage WHERE created_at >= $1 AND user_id = $2 GROUP BY task ORDER BY cost DESC`,
      [since, userId],
    ),
  ]);
  return { since, caps: caps(), spent: s, byTask };
}

// ── Batches (Claude only, 50% off) ──────────────────────────────────────────
// For work that can wait up to an hour or so (the nightly resumes). The same
// budget caps apply, checked up front on the worst case at the batch price.

export const BATCH_DISCOUNT = 0.5;

/**
 * Submit [{ id, system, user, schema, maxTokens }] for one Claude task as a
 * batch. Returns { batchId, model }. Throws BudgetExceededError like complete().
 */
export async function submitBatch({ task, items, userId }) {
  const step = (ROUTES[task] || []).find(s => s.provider === 'anthropic');
  if (!step) throw new Error(`Task ${task} has no Claude route to batch`);
  if (!hasClaudeKey()) throw Object.assign(new Error('Resume writing needs the Claude API key, which isn’t set on the server.'), { status: 503 });
  const key = `${step.provider}:${step.model}`;
  const estimate = items.reduce((sum, it) => sum + estimateCost(key, { system: it.system, user: it.user, maxTokens: it.maxTokens || 4000 }), 0) * BATCH_DISCOUNT;
  await assertBudget(userId, estimate);
  const r = await claudeBatchSubmit(items.map(it => ({
    customId: it.id, system: it.system, user: it.user, schema: it.schema, maxTokens: it.maxTokens, effort: step.effort,
    cacheSystem: Boolean(it.system && it.system.length > 4000),
  })));
  return { batchId: r.id, model: step.model };
}

/**
 * Results of a batch once it has ended (null while it's still running):
 * Map(id → { ok, text, costUsd, model } | { ok: false, error, retry }).
 * Usage is recorded per item at the batch price, under each item's user.
 */
export async function collectBatch({ task, batchId, owners = {}, maxTokens = {} }) {
  if ((await claudeBatchStatus(batchId)) !== 'ended') return null;
  const out = new Map();
  for (const r of await claudeBatchResults(batchId, maxTokens)) {
    const model = r.model || (ROUTES[task] || []).find(s => s.provider === 'anthropic')?.model;
    let costUsd = 0;
    if (r.usage) {
      costUsd = costOf(`anthropic:${model}`, r.usage) * BATCH_DISCOUNT;
      await run(
        `INSERT INTO ai_usage (user_id, task, provider, model, input_tokens, cached_input_tokens, output_tokens, cost_usd, ok, error)
              VALUES ($1, $2, 'anthropic', $3, $4, $5, $6, $7, $8, $9)`,
        [owners[r.customId] || null, `${task}_batch`, model, r.usage.input || 0, r.usage.cachedInput || 0, r.usage.output || 0, costUsd, r.ok, r.ok ? null : String(r.error).slice(0, 300)],
      ).catch(err => console.warn('[llm] batch usage not recorded:', err.message));
    }
    out.set(r.customId, { ...r, costUsd });
  }
  return out;
}
