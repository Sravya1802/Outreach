import { GoogleGenerativeAI } from '@google/generative-ai';
import { cleanOutreachTemplate } from './outreachTemplates.js';

const CANDIDATE = {
  name:    'Sravya Rachakonda',
  degree:  "Master's student in Computer Science",
  website: 'https://sravyarachakonda.com',
  seeking: 'Summer 2026 Software Engineering / AI/ML internship',
  background: `Master's CS student with software engineering and CS research background.
Focused on systems, ML infrastructure, and applied AI.
Looking for Summer 2026 internships at top tech, quant, and AI companies.`,
};

// ─── Seniority-aware prompt builders ─────────────────────────────────────────

function buildEmailPrompt({ recipientName, recipientTitle, companyName, companyCategory, extraContext, hasApplied, rolesAvailable, specificAchievement, position, isRecruiter }) {
  const hasTitle = recipientTitle && recipientTitle !== 'No title' && recipientTitle.trim();
  const roleContext = hasTitle
    ? `${recipientName} is a ${recipientTitle} at ${companyName} (${companyCategory || 'tech company'}).`
    : `${recipientName} works at ${companyName} (${companyCategory || 'tech company'}) — exact role unknown.`;

  const audienceMode = isRecruiter
    ? 'recruiter (lead with relevant credentials + clear ask, NOT with a technical hook they won\'t parse)'
    : 'engineer/IC (lead with a specific technical hook tied to their team\'s work)';

  const scenarioBrief = hasApplied
    ? `Sravya has ALREADY APPLIED for ${position || 'a role'} at ${companyName}. The email goal is a referral or visibility boost, NOT a fresh introduction. Acknowledge the application and ask for advice or referral.`
    : rolesAvailable
      ? `Sravya is interested in a specific role: ${rolesAvailable}. The email goal is to surface intent + ask for a referral or advice.`
      : `No specific role identified yet. Goal: get on their radar for Summer 2026 + ask for a quick intro or pointer.`;

  const system = `You are writing cold outreach for Sravya Rachakonda, a Master's CS student. Your output gets sent verbatim — every email is per-recipient, never templated.

About Sravya (use the most relevant 1-2 details for THIS company, not all):
- ${CANDIDATE.degree} at UIC (University of Illinois Chicago)
- 2 years at Mercedes-Benz R&D: distributed data pipelines, vehicle telemetry, Kafka/Spark, 500GB+/day
- Current: LLM/RAG research at UIC Cancer Center — clinical data extraction
- Skills: Python, Java, TypeScript, React, Node.js, AWS, Kafka, Spark
- Website: ${CANDIDATE.website}
- Seeking: ${CANDIDATE.seeking}

The audience is a ${audienceMode}.

Hard rules — FOLLOW EXACTLY:
1. NEVER use these openers: "I'm a CS student interested in opportunities", "I hope this email finds you well", "I came across your profile and wanted to connect", "I'd love to chat for 15 minutes". Auto-deleted.
2. NEVER use generic subject lines. Forbidden: "Internship inquiry", "Quick question", "Reaching out". Use formats:
   - "Mercedes-Benz pipelines → your data infra at ${companyName}?"
   - "Built RAG over clinical data — interested in your [team]"
   - "Master's CS + Kafka/Spark — open to a 5-min chat at ${companyName}?"
3. Open with ONE specific hook. Pick the angle that maps best to ${companyName}:
   - Data/infra company → Mercedes-Benz pipeline work
   - AI/ML/healthtech → Cancer Center RAG research
   - Quant/finance → systems + reliability angle
   - Startup → product velocity + full-stack range
4. Body structure (4-5 sentences total):
   (a) Specific hook tied to their team/product/recipient's work
   (b) ONE relevant credential — quote a specific achievement, not generic skills
   (c) Clear ask — referral / intro / 5-min chat. Pick one.
   (d) Sign-off as Sravya
5. Length: 4-6 sentences MAX including sign-off. Cut anything extra.
6. Voice: confident engineer, not eager candidate. No hedging ("just wanted to", "if it's not too much trouble").
7. Use the recipient's first name only. Don't pad with their title.

Return ONLY valid JSON: { "subject": "...", "body": "..." }`;

  const user = `Recipient: ${roleContext}
Scenario: ${scenarioBrief}
${specificAchievement ? `Surface this achievement specifically if it fits: ${specificAchievement}` : ''}
${extraContext ? `Extra context to weave in: ${extraContext}` : ''}

Pick ONE specific hook angle for ${companyName} (data/infra vs AI vs startup vs quant) and write the email. The result should NOT survive a find-and-replace to a different company.`;

  return { system, user };
}

function buildLinkedInPrompt({ recipientName, recipientTitle, companyName, companyCategory, extraContext, hasApplied, rolesAvailable, isRecruiter }) {
  const hasTitle = recipientTitle && recipientTitle !== 'No title' && recipientTitle.trim();
  const roleContext = hasTitle
    ? `${recipientName} is a ${recipientTitle} at ${companyName} (${companyCategory || 'tech company'})`
    : `${recipientName} works at ${companyName} (${companyCategory || 'tech company'})`;

  const audienceMode = isRecruiter ? 'recruiter — lead with credential + clear ask' : 'engineer/IC — lead with technical hook';
  const scenarioBrief = hasApplied
    ? `Already applied for ${rolesAvailable || 'a role'}. Goal: referral / visibility, not introduction.`
    : `No specific role yet. Goal: get on radar + ask for advice or pointer.`;

  const system = `You write LinkedIn connection notes for Sravya Rachakonda, a Master's CS student targeting Summer 2026 internships. Your output is sent verbatim — every note is per-recipient, never templated.

About Sravya (pick ONE relevant detail per note):
- 2 years Mercedes-Benz R&D: Kafka/Spark pipelines (500GB+/day)
- Current: LLM/RAG over clinical data at UIC Cancer Center
- Skills: Python, Java, TS, AWS, Kafka, Spark

Audience: ${audienceMode}.

Hard rules — FOLLOW EXACTLY:
1. Under 280 characters HARD LIMIT (LinkedIn cuts off).
2. Banned openers: "I'm a CS student interested in opportunities", "Hope you're doing well", "I'd love to connect", "I'd love to chat for 15 minutes". Auto-rejected.
3. ONE punchy hook tying YOUR background to THEIR team/product. Pick the angle:
   - Data/infra company → Mercedes-Benz pipeline angle
   - AI/healthtech → Cancer Center RAG angle
   - Quant/finance → systems reliability angle
4. ONE clear ask — referral / intro / advice. Pick one.
5. No emojis. Confident engineer voice, not fan voice.
6. Use first name only.

Format example: "[Specific hook tied to their team]. [One credential]. [Clear ask]?"

Return ONLY valid JSON: { "message": "..." }`;

  const user = `Recipient: ${roleContext}.
Scenario: ${scenarioBrief}
${extraContext ? `Context to weave in: ${extraContext}` : ''}
Pick ONE hook angle for ${companyName}. Under 280 chars. No generic openers. Output should NOT survive find-and-replace to another company.`;

  return { system, user };
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

// ─── Provider implementations ─────────────────────────────────────────────────

let genAI = null;
function getGemini() {
  if (!genAI && process.env.GEMINI_API_KEY) {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  return genAI;
}

let lastGeminiCall = 0;

async function generateWithGemini(system, user) {
  const ai = getGemini();
  if (!ai) throw new Error('Gemini API key not configured');
  const now = Date.now();
  const elapsed = now - lastGeminiCall;
  if (elapsed < 4000) await new Promise(r => setTimeout(r, 4000 - elapsed));
  lastGeminiCall = Date.now();
  const model = ai.getGenerativeModel({ model: 'gemini-2.0-flash' });
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: `${system}\n\n${user}` }] }],
  });
  return parseJSON(result.response.text());
}

async function generateWithAnthropic(system, user) {
  const { claudeText } = await import('./claude.js');
  // Short outreach copy — medium effort is plenty.
  return parseJSON(await claudeText({ system, user, effort: 'medium' }));
}

async function generateWithOpenAI(system, user) {
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const res = await client.chat.completions.create({
    model:    'gpt-4o-mini',
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  });
  return parseJSON(res.choices[0].message.content);
}

// ─── WaaS message prompt ──────────────────────────────────────────────────────

function buildWaaSPrompt({ companyName, companyDescription, industry, ycBatch, contactName, extraContext }) {
  const system = `You write short "reach out" messages for Work at a Startup (YC) company pages. The message goes directly to the founder/hiring manager. These must be casual, specific, and human — NOT corporate email templates.

Rules:
1. 80-200 words max. These are short messages, not essays.
2. Lowercase throughout — use "i" not "I". No capitals except proper nouns.
3. NEVER start with "hi", "hey", "dear", or "hope this message finds you well"
4. Open with ONE specific observation about THIS company (not generic praise)
5. Connect one piece of Sravya's background to their work
6. End with a soft ask: "would love to chat about interning this summer" or similar
7. NO portfolio URL — too formal for this format
8. Sound like a real engineer typing a quick note, not a recruiter

About Sravya Rachakonda (the person writing this):
- Master's CS student at UIC (University of Illinois Chicago)
- 2 years at Mercedes-Benz R&D: distributed data pipelines processing 500GB+ daily, vehicle telemetry systems
- Current: LLM/RAG research at UIC Cancer Center — building retrieval-augmented generation for clinical data
- Skills: Python, Java, TypeScript, React, Node.js, AWS, Kafka, Spark
- Seeking Summer 2026 SWE intern

Return ONLY valid JSON: { "message": "..." }`;

  const user = `Company: ${companyName}
Description: ${companyDescription || 'YC startup'}
Industry: ${industry || 'Tech'}
YC Batch: ${ycBatch || 'Unknown'}
Contact: ${contactName || 'the team'}
${extraContext ? `Extra context: ${extraContext}` : ''}

Write the WaaS reach-out message. Be specific about ${companyName}. Connect to Sravya's most relevant background. Keep it under 200 words.`;

  return { system, user };
}

// ─── High-response-rate templates ─────────────────────────────────────────────

const TEMPLATES = {
  // HIGHEST response rate: when you've already applied
  alreadyApplied: (name, position, company) => ({
    subject: `Just applied for the ${position} internship`,
    body: `Hi ${name},\n\nI came across your profile and noticed you're a recruiter@${company}. I actually just applied for the ${position} internship and was wondering if you'd be open to a call sometime this week or next.\n\nI'd love to learn about your career growth and ${company}!\n\nBest,\nSravya Rachakonda\nsravyarachakonda.com`,
  }),

  // HIGH response rate: when FT positions exist but no internship listed
  ftsAvailableNoInterns: (name, position, company) => ({
    subject: `Internship inquiry for ${company}`,
    body: `Hi ${name},\n\nI came across your profile and noticed you're a recruiter@${company}. I saw a lot of openings for ${position} roles and was wondering if you guys were looking for any interns?\n\nWould you be open to a call sometime this week or next? I'd love to learn about your career growth and ${company}!\n\nBest,\nSravya Rachakonda\nsravyarachakonda.com`,
  }),

  // GOOD response: when no open role, asking decision maker directly
  noRoleAvailable: (name, company) => ({
    subject: `Quick question about ${company}`,
    body: `Hi ${name},\n\nI came across your profile and noticed you're at ${company}. I'm actually looking for Summer 2026 internships and was wondering if you'd know about any opportunities?\n\nWould you be open to a call sometime? I'd love to learn about your career growth and ${company}!\n\nBest,\nSravya Rachakonda\nsravyarachakonda.com`,
  }),

  // Seek advice + ask for introduction to hiring team
  seekingAdvice: (name, position, company) => ({
    subject: `Advice on ${position} at ${company}`,
    body: `Hi ${name},\n\nI came across the ${position} role at ${company} and it aligns perfectly with my background in AI/ML and software engineering. I'm genuinely interested in this opportunity.\n\nWould you have a few minutes to share your perspective on the role and team? If it seems like a good fit, I'd also appreciate if you could connect me with the right person on the hiring team.\n\nThank you for your time.\n\nBest regards,\nSravya Rachakonda\nsravyarachakonda.com`,
  }),

  // Short ask for advice (builds momentum)
  quickQuestion: (name, question, company) => ({
    subject: `${name}, 1-minute question`,
    body: `Hi ${name},\n\nI saw you were at ${company} and wanted to ask:\n\n${question || 'If you were breaking into this space today, what skills would you focus on?'}\n\nYour input means a lot — even a one-line response would be great!\n\nThanks,\nSravya Rachakonda`,
  }),
};

// ─── LinkedIn-specific templates (280 char limit) ─────────────────────────────

const LINKEDIN_TEMPLATES = {
  // HIGHEST response: direct about applied role
  alreadyApplied: (name, position, company) => ({
    message: `Hi ${name}, just applied for the ${position} internship at ${company}. Would you be open to a quick chat this week? Would love to learn about the team.`,
  }),

  // HIGH response: asking about internships when FT roles visible
  ftsAvailableNoInterns: (name, position, company) => ({
    message: `Hi ${name}, saw ${company} is hiring for ${position} roles. Any chance you're looking for interns? I'm a Master's student and would love to chat.`,
  }),

  // Direct ask: no open role
  noRoleAvailable: (name, company) => ({
    message: `Hi ${name}, I came across your profile at ${company}. I'm looking for Summer 2026 internships — any opportunities I should know about?`,
  }),

  // Referral request: ask for introduction to right contact
  seekingAdvice: (name, position, company) => ({
    message: `Hi ${name}, I'm interested in the ${position} role at ${company} and your work there caught my attention. Would you be open to connecting me with the right person on your team?`,
  }),

  // Quick question: builds momentum
  quickQuestion: (name, question, company) => ({
    message: `Hi ${name}, quick question: ${question || 'what skills matter most for breaking into your space?'} Even a one-line response would help!`,
  }),
};

function templateGuidance(type, customTemplates) {
  if (!customTemplates) return ''
  const key = type === 'linkedin' ? 'linkedin' : 'email'
  const primary = cleanOutreachTemplate(customTemplates[key])
  const variants = Array.isArray(customTemplates.variants)
    ? customTemplates.variants.filter(v => v && v.kind === key && v.body)
    : []
  if (!primary && variants.length === 0) return ''
  let guidance = ''
  if (primary) {
    guidance += `\n\nUser's preferred ${key} template/style anchor. Mirror its tone, structure, length, and directness while still personalizing to the recipient and company. Do not copy placeholders literally:\n${primary}`
  }
  if (variants.length > 0) {
    guidance += `\n\nAdditional ${key} style examples the user has saved (treat as alternative tones; pick the closest match for this recipient):\n`
    guidance += variants.slice(0, 5).map(v => `[${v.name || 'Variant'}]\n${v.body}`).join('\n---\n')
  }
  return guidance
}

// Detect scenario and return best template
function detectScenarioAndTemplate(params) {
  const { recipientName, recipientTitle, companyName, hasApplied, rolesAvailable, specificAchievement, isRecruiter } = params;

  // Scenario 1: Already applied for this role — HIGHEST conversion
  if (hasApplied) {
    const position = params.position || 'Software Engineering';
    return { template: 'alreadyApplied', data: [recipientName, position, companyName] };
  }

  // Scenario 2: FT roles available but asking about internships — HIGH conversion
  if (rolesAvailable && !rolesAvailable.includes('intern') && isRecruiter) {
    const position = params.position || 'Software Engineering';
    return { template: 'ftsAvailableNoInterns', data: [recipientName, position, companyName] };
  }

  // Scenario 3: Has role but want referral/advice approach
  if (rolesAvailable) {
    const position = params.position || 'Software Engineering';
    return { template: 'seekingAdvice', data: [recipientName, position, companyName] };
  }

  // Scenario 4: No role, ask quick question
  if (!rolesAvailable) {
    const question = params.extraContext || `If you were looking to break into ${companyName}'s team today, what would be the most valuable skill?`;
    return { template: 'quickQuestion', data: [recipientName, question, companyName] };
  }

  // Scenario 4: Default fallback
  return { template: 'noRoleAvailable', data: [recipientName, companyName] };
}

export function generateOutreachTemplate({ recipientName, recipientTitle, companyName, hasApplied, rolesAvailable, specificAchievement, position, isRecruiter, extraContext, type }) {
  const scenario = detectScenarioAndTemplate({
    recipientName,
    recipientTitle,
    companyName,
    hasApplied,
    rolesAvailable,
    specificAchievement,
    position,
    isRecruiter,
    extraContext,
  });

  const templateMap = type === 'linkedin' ? LINKEDIN_TEMPLATES : TEMPLATES;
  const templateFunc = templateMap[scenario.template];
  if (templateFunc) {
    return templateFunc(...scenario.data);
  }

  return null;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function generateCoverLetter({ companyName, companyDescription, roleTitle, extraContext }) {
  const system = `You write internship cover letters for Sravya Rachakonda. Format: 3 paragraphs, 300-500 words total. Professional but direct — not stiff.

About Sravya:
- Master's CS student at UIC (University of Illinois Chicago)
- 2 years at Mercedes-Benz R&D: distributed data pipelines processing 500GB+ daily, vehicle telemetry, Kafka, Spark
- Current: LLM/RAG research at UIC Cancer Center — building retrieval-augmented generation for clinical data
- Skills: Python, Java, TypeScript, React, Node.js, AWS, Kafka, Spark
- Website: sravyarachakonda.com
- Seeking: Summer 2026 software engineering / AI/ML internship

Paragraph 1: Specific opening — reference something real about this company. NOT "I am writing to express interest..."
Paragraph 2: Lead with most relevant experience. Data/infra companies → Mercedes-Benz pipeline work. AI/health → Cancer Center LLM research. Connect to what this company actually does.
Paragraph 3: Brief skills mention + clear ask for internship opportunity.

Sign off as: Sravya Rachakonda

Return ONLY valid JSON: { "subject": "...", "body": "..." }`;

  const user = `Write a cover letter for a Summer 2026 internship at ${companyName}.
${roleTitle ? `Role: ${roleTitle}` : ''}
${companyDescription ? `About the company: ${companyDescription.slice(0, 500)}` : ''}
${extraContext ? `Extra context: ${extraContext}` : ''}

Address: "Dear Hiring Manager,"
Make paragraph 1 specific to ${companyName}. Choose background based on company type.`;

  const provider  = process.env.AI_PROVIDER || 'gemini';
  const providers = [provider, 'gemini', 'anthropic', 'openai'].filter((v, i, a) => a.indexOf(v) === i);

  for (const p of providers) {
    try {
      if (p === 'gemini')                                    return await generateWithGemini(system, user);
      if (p === 'anthropic' && process.env.ANTHROPIC_API_KEY) return await generateWithAnthropic(system, user);
      if (p === 'openai'    && process.env.OPENAI_API_KEY)    return await generateWithOpenAI(system, user);
    } catch (err) {
      console.error(`[ai/cover-letter] ${p} failed: ${err.message}`);
    }
  }

  return {
    subject: `Summer 2026 Internship Application — Sravya Rachakonda`,
    body: `Dear Hiring Manager,\n\nI'm a Master's CS student at UIC with two years of industry experience at Mercedes-Benz R&D and current LLM/RAG research at UIC Cancer Center. I'm interested in joining ${companyName} as a Summer 2026 software engineering intern.\n\nAt Mercedes-Benz, I built distributed data pipelines processing 500GB+ daily using Kafka and Spark. I'm currently developing retrieval-augmented generation systems for clinical data. I believe this background aligns well with ${companyName}'s technical challenges.\n\nI'd welcome the opportunity to discuss how I can contribute to your team.\n\nSravya Rachakonda\nsravyarachakonda.com`,
  };
}

export async function generateWaaSMessage({ companyName, companyDescription, industry, ycBatch, contactName, extraContext }) {
  const { system, user } = buildWaaSPrompt({ companyName, companyDescription, industry, ycBatch, contactName, extraContext });
  const provider  = process.env.AI_PROVIDER || 'gemini';
  const providers = [provider, 'gemini', 'anthropic', 'openai'].filter((v, i, a) => a.indexOf(v) === i);

  for (const p of providers) {
    try {
      if (p === 'gemini')                                    return await generateWithGemini(system, user);
      if (p === 'anthropic' && process.env.ANTHROPIC_API_KEY) return await generateWithAnthropic(system, user);
      if (p === 'openai'    && process.env.OPENAI_API_KEY)    return await generateWithOpenAI(system, user);
    } catch (err) {
      console.error(`[ai/waas] ${p} failed: ${err.message}`);
    }
  }
  // Fallback
  return {
    message: `noticed ${companyName} is building something interesting — i've spent two years at mercedes-benz r&d working on distributed data pipelines and i'm currently doing llm/rag research at uic. would love to chat about interning this summer if you're looking for eng interns.`,
  };
}

export async function generateOutreach({ type, recipientName, recipientTitle, companyName, companyCategory, companyStage, hasApplied, rolesAvailable, specificAchievement, position, isRecruiter, extraContext, customTemplates }) {
  // ALWAYS use AI generation as the primary path. Per-recipient personalization
  // (company-specific hook, role-aware angle, recruiter vs IC framing) only
  // works when a model sees the full context. The static high-response
  // templates remain as an in-memory fallback if every AI provider fails.

  const category = companyCategory || companyStage || '';
  const params = {
    recipientName, recipientTitle, companyName, companyCategory: category,
    extraContext, hasApplied, rolesAvailable, specificAchievement, position, isRecruiter,
  };
  const built = type === 'linkedin'
    ? buildLinkedInPrompt(params)
    : buildEmailPrompt(params);
  const guidance = templateGuidance(type, customTemplates);
  const system = built.system + guidance;
  const user = built.user;

  const provider  = process.env.AI_PROVIDER || 'gemini';
  const providers = [provider, 'gemini', 'anthropic', 'openai'].filter((v, i, a) => a.indexOf(v) === i);

  for (const p of providers) {
    try {
      if (p === 'gemini')                                    return await generateWithGemini(system, user);
      if (p === 'anthropic' && process.env.ANTHROPIC_API_KEY) return await generateWithAnthropic(system, user);
      if (p === 'openai'    && process.env.OPENAI_API_KEY)    return await generateWithOpenAI(system, user);
    } catch (err) {
      console.error(`[ai] ${p} failed: ${err.message}`);
    }
  }

  // AI failed — fall back to high-response static template
  if (type !== 'linkedin') {
    const templateResult = generateOutreachTemplate({
      recipientName, recipientTitle, companyName, hasApplied, rolesAvailable,
      specificAchievement, position, isRecruiter, extraContext, type,
    });
    if (templateResult) return templateResult;
  }

  // Last-resort fallback (should never be reached with valid API keys)
  return {
    subject: `Master's CS → ${companyName}?`,
    body: `Hi ${recipientName},\n\nI came across ${companyName}'s work and wanted to reach out directly. I'm a Master's CS student with a background in software engineering and research, targeting Summer 2026.\n\nWould you be open to a quick intro, or point me to the right person on your team?\n\n— Sravya\n${CANDIDATE.website}`,
    message: `Came across your work at ${companyName} — I'm a CS Master's student focused on [relevant area]. Any chance you'd share how your team approaches [specific challenge]?`,
  };
}
