// ── Claude (Anthropic) — shared client for every Claude code path ────────────
//
// One place that knows the current API rules, so the four call sites
// (ai.js, jobEvaluator.js, resumeGenerator.js, categorize.js) can't drift:
//   • claude-opus-5-5 always thinks; depth/cost is controlled by
//     output_config.effort (default would be "medium" — we set it explicitly).
//   • Sampling params (temperature/top_p) are rejected — never send them.
//   • Thinking counts toward max_tokens, so leave room for it.
//   • The first content block may be `thinking` — read text blocks by type.
//   • A safety-classifier decline is HTTP 200 with stop_reason "refusal";
//     server-side fallbacks ("default" mode) retry it on a suitable model.
//   • The SDK retries 408/409/429/5xx + connection errors itself (maxRetries).
import Anthropic from '@anthropic-ai/sdk';

export const CLAUDE_MODEL = 'claude-opus-5-5';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export class ClaudeRefusalError extends Error {
  constructor(category) {
    super(`Claude declined the request${category ? ` (${category})` : ''}`);
    this.name = 'ClaudeRefusalError';
    this.category = category || null;
  }
}

export function hasClaudeKey() {
  const key = (process.env.ANTHROPIC_API_KEY || '').trim();
  return Boolean(key) && key !== 'optional_fallback';
}

let client = null;
let clientKey = null;
function getClient(options) {
  const key = process.env.ANTHROPIC_API_KEY;
  // Rebuild if the key changed (pm2 --update-env) or a test injects options.
  if (options || !client || clientKey !== key) {
    client = new Anthropic({ apiKey: key, timeout: 120_000, maxRetries: 2, ...options });
    clientKey = key;
  }
  return client;
}

/**
 * Send one system + user turn and return the reply text.
 *
 * @param {object} p
 * @param {string} [p.system]       System prompt.
 * @param {string}  p.user          User message.
 * @param {'low'|'medium'|'high'|'xhigh'|'max'} p.effort  Thinking depth for this task.
 * @param {number} [p.maxTokens]    Output ceiling incl. thinking (default 16000).
 * @param {boolean} [p.cacheSystem] Mark the system prompt for prompt caching
 *                                  (use when it's a long, stable rubric).
 * @param {object} [p.clientOptions] Test hook (e.g. a mock `fetch`).
 */
export async function claudeText(params) {
  return (await claudeMessage(params)).text;
}

/** Like claudeText, but also returns token usage (for cost metering) and the model that answered. */
export async function claudeMessage({ system, user, effort, maxTokens = 16000, cacheSystem = false, timeoutMs, clientOptions }) {
  if (!effort) throw new Error('claudeText: effort is required');
  const response = await getClient(clientOptions).beta.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: maxTokens,
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
    output_config: { effort },
    ...(system
      ? { system: cacheSystem ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] : system }
      : {}),
    messages: [{ role: 'user', content: user }],
  }, timeoutMs ? { timeout: timeoutMs } : undefined);

  // Check why it stopped before trusting the content.
  if (response.stop_reason === 'refusal') throw new ClaudeRefusalError(response.stop_details?.category);
  if (response.stop_reason === 'max_tokens') {
    throw new Error(`Claude reply was cut off at max_tokens=${maxTokens}`);
  }

  const text = response.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
    .trim();
  if (!text) throw new Error(`Claude returned no text (stop_reason: ${response.stop_reason})`);
  const u = response.usage || {};
  return {
    text,
    model: response.model || CLAUDE_MODEL,
    usage: {
      input: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0),
      cachedInput: u.cache_read_input_tokens || 0,
      output: u.output_tokens || 0,
    },
  };
}
