// One door for every AI call: routes each task to its model, meters the real
// cost of every call in ai_usage, and refuses calls once a monthly budget is
// spent (a hard cap on top of the limits set in each provider's console).
//
//   score, evaluate, email, categorize → Groq gpt-oss (OpenAI as backup)
//   resume, cover_letter               → Claude Opus 5.5 only. If it's down
//                                        the caller waits and retries; resume
//                                        quality is never quietly downgraded.
import OpenAI from 'openai';
import { all, one, run } from '../db.js';
import { claudeMessage, hasClaudeKey } from './claude.js';
import { currentUserId } from './requestContext.js';

// USD per 1M tokens: [input, cached input, output]. Rounded up where sources
// disagree, so the cap trips early rather than late.
export const PRICES = {
  'groq:openai/gpt-oss-120b': [0.15, 0.075, 0.60],
  'groq:openai/gpt-oss-20b': [0.10, 0.05, 0.50],
  'openai:gpt-4o-mini': [0.15, 0.075, 0.60],
  'openai:gpt-4o': [2.50, 1.25, 10.00],
  'anthropic:claude-opus-5-5': [4.00, 0.40, 20.00],
};

export const ROUTES = {
  score: [{ provider: 'groq', model: 'openai/gpt-oss-120b', reasoning: 'low' }, { provider: 'openai', model: 'gpt-4o-mini' }],
  evaluate: [{ provider: 'groq', model: 'openai/gpt-oss-120b', reasoning: 'medium' }, { provider: 'openai', model: 'gpt-4o-mini' }],
  email: [{ provider: 'groq', model: 'openai/gpt-oss-120b', reasoning: 'low' }, { provider: 'openai', model: 'gpt-4o-mini' }],
  categorize: [{ provider: 'groq', model: 'openai/gpt-oss-20b', reasoning: 'low' }, { provider: 'openai', model: 'gpt-4o-mini' }],
  resume: [{ provider: 'anthropic', model: 'claude-opus-5-5', effort: 'high' }],
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
function openaiCompatible(provider) {
  const key = provider === 'groq' ? process.env.GROQ_API_KEY : process.env.OPENAI_API_KEY;
  if (!key) return null;
  const id = `${provider}:${key.slice(-6)}`;
  if (!clients[id]) {
    clients[id] = new OpenAI({
      apiKey: key,
      ...(provider === 'groq' ? { baseURL: 'https://api.groq.com/openai/v1' } : {}),
      timeout: 120_000,
      maxRetries: 2,
    });
  }
  return clients[id];
}

function available(step) {
  if (step.provider === 'anthropic') return hasClaudeKey();
  return Boolean(openaiCompatible(step.provider));
}

async function callStep(step, { system, user, json, maxTokens, timeoutMs }) {
  if (step.provider === 'anthropic') {
    const r = await claudeMessage({ system, user, effort: step.effort, maxTokens, cacheSystem: Boolean(system && system.length > 4000), timeoutMs });
    return { text: r.text, usage: r.usage };
  }
  const client = openaiCompatible(step.provider);
  const res = await client.chat.completions.create({
    model: step.model,
    messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: user }],
    max_completion_tokens: maxTokens,
    ...(json ? { response_format: { type: 'json_object' } } : {}),
    ...(step.reasoning && step.provider === 'groq' ? { reasoning_effort: step.reasoning } : {}),
  }, timeoutMs ? { timeout: timeoutMs } : undefined);
  const text = res.choices?.[0]?.message?.content?.trim() || '';
  if (!text) throw new Error(`${step.provider} returned no text (finish_reason: ${res.choices?.[0]?.finish_reason})`);
  const u = res.usage || {};
  const cached = u.prompt_tokens_details?.cached_tokens || 0;
  return { text, usage: { input: (u.prompt_tokens || 0) - cached, cachedInput: cached, output: u.completion_tokens || 0 } };
}

/**
 * Run one AI task. Returns { text, provider, model, costUsd }.
 * @param {{ task: keyof ROUTES, system?: string, user: string, json?: boolean, maxTokens?: number, timeoutMs?: number, userId?: string }} p
 */
export async function complete({ task, system = '', user, json = false, maxTokens = 4000, timeoutMs, userId = currentUserId() }) {
  const route = ROUTES[task];
  if (!route) throw new Error(`Unknown AI task: ${task}`);
  const steps = route.filter(available);
  if (!steps.length) {
    throw Object.assign(new Error(task === 'resume' || task === 'cover_letter'
      ? 'Resume writing needs the Claude API key, which isn’t set on the server.'
      : 'No AI provider key is set on the server.'), { status: 503 });
  }
  const errors = [];
  for (const step of steps) {
    const key = `${step.provider}:${step.model}`;
    await assertBudget(userId, estimateCost(key, { system, user, maxTokens }));
    try {
      const r = await callStep(step, { system, user, json, maxTokens, timeoutMs });
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
