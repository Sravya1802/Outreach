// ── Who is sending this outreach? ────────────────────────────────────────────
//
// Outreach, cover letters and WaaS notes must be written as the signed-in
// user, from their own profile and resume. (They used to be hardcoded to the
// founder's name, school, employers and website for every account.)

const RESUME_EXCERPT_CHARS = 2500;

function clean(v) {
  return String(v ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Build the sender from a user_profile row and saved resume text. Pure, so it
 * can be unit-tested; loadSenderProfile() does the DB reads.
 * Returns null when there is nothing to write as (no name and no resume).
 */
export function buildSenderProfile(profile = {}, resumeText = '') {
  const first = clean(profile.first_name);
  const last = clean(profile.last_name);
  const name = clean(`${first} ${last}`);
  const resume = String(resumeText || '').trim();
  if (!name && resume.length < 50) return null;

  const education = [profile.education_degree, profile.education_major && `in ${profile.education_major}`, profile.education_school && `at ${profile.education_school}`]
    .map(clean).filter(Boolean).join(' ');
  const current = [profile.current_title, profile.current_company && `at ${profile.current_company}`].map(clean).filter(Boolean).join(' ');
  const website = clean(profile.portfolio_url) || clean(profile.github_url) || clean(profile.linkedin_url);
  const seeking = clean(profile.target_job_type) || 'software engineering internship / new-grad roles';

  const facts = [
    education && `Education: ${education}${profile.graduation_date ? ` (graduating ${clean(profile.graduation_date)})` : ''}`,
    current && `Current role: ${current}`,
    profile.skills && `Skills: ${clean(profile.skills).slice(0, 300)}`,
    profile.projects && `Projects: ${clean(profile.projects).slice(0, 400)}`,
    `Seeking: ${seeking}`,
    website && `Website: ${website}`,
  ].filter(Boolean);

  return {
    name: name || 'the candidate',
    firstName: first || name.split(' ')[0] || '',
    website,
    seeking,
    facts,
    resumeExcerpt: resume.slice(0, RESUME_EXCERPT_CHARS),
    signature: [name, website].filter(Boolean).join('\n'),
  };
}

/** Prompt block describing the sender. Facts first; the resume fills gaps. */
export function describeSender(sender) {
  const lines = [`Name: ${sender.name}`, ...sender.facts.map(f => `- ${f}`)];
  if (sender.resumeExcerpt) {
    lines.push('', 'Their resume (the only source of credentials — never invent employers, numbers or projects):', sender.resumeExcerpt);
  }
  return lines.join('\n');
}

export class MissingSenderProfileError extends Error {
  constructor() {
    super('Add your name in your application profile or upload your resume first — outreach is written from them.');
    this.name = 'MissingSenderProfileError';
    this.status = 400;
  }
}

export async function loadSenderProfile(userId) {
  // Lazy: keeps this module (and ai.js, which imports it) loadable without a DB.
  const { one } = await import('../db.js');
  const [profile, resume] = await Promise.all([
    one('SELECT * FROM user_profile WHERE user_id = $1', [userId]),
    one("SELECT value FROM meta WHERE user_id = $1 AND key = 'user_resume_text'", [userId]),
  ]);
  const sender = buildSenderProfile(profile || {}, resume?.value || '');
  if (!sender) throw new MissingSenderProfileError();
  return sender;
}
