// ai.js — the cover letter writer. The app writes no outreach (emails, LinkedIn
// notes, founder messages): the user's Claude run writes those from
// tailoring_config.email_template.
import { complete } from './llm.js';
import { describeSender, MissingSenderProfileError } from './senderProfile.js';

// `sender` (services/senderProfile.js) is the signed-in user's own name,
// background and resume. Nothing about any real person is hardcoded here.
function requireSender(sender) {
  if (!sender?.name) throw new MissingSenderProfileError();
  return sender;
}

// ─── JSON parser ──────────────────────────────────────────────────────────────

function parseJSON(text) {
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  try { return JSON.parse(cleaned); } catch (_) {}
  // Gemini sometimes adds surrounding text — extract the first JSON object
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) return JSON.parse(match[0]);
  throw new SyntaxError(`No JSON object found in AI response: ${cleaned.slice(0, 120)}`);
}

export async function generateCoverLetter({ companyName, companyDescription, roleTitle, extraContext, sender }) {
  requireSender(sender);
  const system = `You write internship cover letters for ${sender.name}. Format: 3 paragraphs, 300-500 words total. Professional but direct — not stiff.

About the applicant:
${describeSender(sender)}

Paragraph 1: Specific opening — reference something real about this company. NOT "I am writing to express interest..."
Paragraph 2: Lead with the applicant's most relevant experience for this company (only facts listed above). Connect it to what this company actually does.
Paragraph 3: Brief skills mention + clear ask for internship opportunity.

Sign off as: ${sender.name}

Return ONLY valid JSON: { "subject": "...", "body": "..." }`;

  const user = `Write a cover letter for ${roleTitle ? `the ${roleTitle} role` : 'an internship'} at ${companyName}.
${roleTitle ? `Role: ${roleTitle}` : ''}
${companyDescription ? `About the company: ${companyDescription.slice(0, 500)}` : ''}
${extraContext ? `Extra context: ${extraContext}` : ''}

Address: "Dear Hiring Manager,"
Make paragraph 1 specific to ${companyName}. Choose background based on company type.`;

  try {
    return parseJSON((await complete({ task: 'cover_letter', system, user, json: true, maxTokens: 6000 })).text);
  } catch (err) {
    if (err.name === 'BudgetExceededError') throw err;
    console.error(`[ai/cover-letter] ${err.message}`);
  }

  throw new Error('Couldn’t write the cover letter right now. Try again in a minute.');
}
