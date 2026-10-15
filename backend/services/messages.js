/**
 * messages.js — the People → Messages page: every company where the user has
 * someone (LinkedIn connections export + contacts found for them), the people
 * there, and a personalized LinkedIn note + email for each, drafted on demand
 * and saved on the contact (job_contacts.generated_*).
 */

import { all, one, run } from '../db.js';
import { complete } from './llm.js';
import { companyKey } from './linkedinConnections.js';
import { companyRow, contactFor, me } from './referralFlow.js';
import { marketFor, regionForMarket } from './markets.js';

const PAGE = 25;
const lc = (s) => String(s ?? '').trim().toLowerCase();
const str = (s) => String(s ?? '').trim();

/** Every company with people, merged across connections and saved contacts, with open roles. */
export async function companyList(userId, { q = '', filter = 'all', page = 1 } = {}) {
  const conns = await all(
    `SELECT company_key AS key, max(company) AS name, COUNT(*)::int AS n FROM linkedin_connections
      WHERE user_id = $1 AND company_key <> '' GROUP BY company_key`,
    [userId],
  );
  const saved = await all(
    `SELECT j.name, COUNT(c.id)::int AS n, COUNT(c.id) FILTER (WHERE c.email IS NOT NULL AND COALESCE(c.email_status,'') <> 'invalid')::int AS emails,
            COUNT(c.id) FILTER (WHERE c.status IN ('sent','dm_sent','replied','connected'))::int AS contacted,
            COUNT(c.id) FILTER (WHERE c.generated_dm IS NOT NULL OR c.generated_body IS NOT NULL)::int AS drafted
       FROM jobs j JOIN job_contacts c ON c.job_id = j.id WHERE j.user_id = $1 GROUP BY j.name`,
    [userId],
  );
  const region = regionForMarket(await marketFor(userId));
  const roles = await all(
    `SELECT company_name, COUNT(*)::int AS n FROM scraped_roles
      WHERE is_active = 1 AND region = $1 AND COALESCE(posted_at, scraped_at) > NOW() - INTERVAL '30 days' GROUP BY company_name`,
    [region],
  );
  const byKey = new Map();
  const get = (key, name) => {
    if (!byKey.has(key)) byKey.set(key, { key, name, connections: 0, contacts: 0, emails: 0, contacted: 0, drafted: 0, openRoles: 0 });
    return byKey.get(key);
  };
  for (const c of conns) get(c.key, c.name).connections += c.n;
  for (const s of saved) {
    const k = companyKey(s.name);
    if (!k) continue;
    const row = get(k, s.name);
    row.name = s.name; // the user's own spelling wins
    row.contacts += s.n; row.emails += s.emails; row.contacted += s.contacted; row.drafted += s.drafted;
  }
  const roleCount = new Map();
  for (const r of roles) { const k = companyKey(r.company_name); if (k) roleCount.set(k, (roleCount.get(k) || 0) + r.n); }
  for (const row of byKey.values()) row.openRoles = roleCount.get(row.key) || 0;

  let list = [...byKey.values()];
  const query = lc(q);
  if (query) list = list.filter(r => lc(r.name).includes(query));
  if (filter === 'roles') list = list.filter(r => r.openRoles > 0);
  if (filter === 'connections') list = list.filter(r => r.connections > 0);
  if (filter === 'emails') list = list.filter(r => r.emails > 0);
  list.sort((a, b) => (b.openRoles > 0) - (a.openRoles > 0) || b.connections - a.connections || b.emails - a.emails || a.name.localeCompare(b.name));
  const total = list.length;
  const p = Math.max(1, Number(page) || 1);
  return { total, page: p, pageSize: PAGE, companies: list.slice((p - 1) * PAGE, p * PAGE) };
}

/** The best open role at a company for this user: their own scored plan item, else the newest matching listing. */
async function bestRole(userId, key, displayName) {
  const scored = await all(
    `SELECT title, apply_url, company_name, score FROM plan_items WHERE user_id = $1 AND tier IN ('top','worth') ORDER BY score DESC NULLS LAST LIMIT 400`,
    [userId],
  );
  const hit = scored.find(r => companyKey(r.company_name) === key);
  if (hit) return { title: hit.title, url: hit.apply_url };
  const region = regionForMarket(await marketFor(userId));
  const rows = await all(
    `SELECT title, apply_url, company_name FROM scraped_roles WHERE is_active = 1 AND region = $1 AND lower(company_name) LIKE $2
      ORDER BY COALESCE(posted_at, scraped_at) DESC LIMIT 20`,
    [region, `%${lc(displayName).split(' ')[0]}%`],
  );
  const r = rows.find(x => companyKey(x.company_name) === key);
  return r ? { title: r.title, url: r.apply_url } : null;
}

/** People at one company: connections and saved contacts merged, with saved drafts. */
export async function companyPeople(userId, key) {
  const conns = await all('SELECT * FROM linkedin_connections WHERE user_id = $1 AND company_key = $2', [userId, key]);
  const contacts = (await all(
    `SELECT c.*, j.name AS company_name FROM job_contacts c JOIN jobs j ON j.id = c.job_id WHERE c.user_id = $1`,
    [userId],
  )).filter(c => companyKey(c.company_name) === key);
  const name = contacts[0]?.company_name || conns[0]?.company || key;
  const people = [];
  const used = new Set();
  for (const k of conns) {
    const match = contacts.find(c => (k.profile_url && lc(c.linkedin_url) === lc(k.profile_url)) || lc(c.name) === lc(k.full_name));
    if (match) used.add(match.id);
    people.push(person({ connection: k, contact: match }));
  }
  for (const c of contacts) if (!used.has(c.id)) people.push(person({ contact: c }));
  const rank = (p) => (/recruit|talent|university|campus/i.test(p.title || '') ? 0 : /engineer|developer|scientist|software|data/i.test(p.title || '') ? 1 : 2);
  people.sort((a, b) => (b.isConnection - a.isConnection) || rank(a) - rank(b) || String(a.name).localeCompare(b.name));
  return { key, name, role: await bestRole(userId, key, name), people };
}

function person({ connection, contact }) {
  return {
    ref: contact ? `c:${contact.id}` : `l:${connection.id}`,
    contactId: contact?.id ?? null,
    connectionId: connection?.id ?? null,
    isConnection: Boolean(connection),
    name: connection?.full_name || contact?.name,
    title: connection?.position || contact?.title || null,
    linkedinUrl: connection?.profile_url || contact?.linkedin_url || null,
    email: (contact?.email_status === 'invalid' ? null : contact?.email) || connection?.email || null,
    emailStatus: contact?.email_status || null,
    status: contact?.status || 'pending',
    note: contact?.generated_dm || null,
    subject: contact?.generated_subject || null,
    body: contact?.generated_body || null,
  };
}

async function candidateHighlights(userId) {
  const m = await one("SELECT parsed FROM resume_files WHERE user_id = $1 AND kind = 'master' AND is_current", [userId]);
  const p = m?.parsed;
  if (!p) return '';
  const exp = (p.experience || []).slice(0, 2).map(e => `${e.title} at ${e.company}: ${(e.bullets || [])[0] || ''}`);
  const proj = (p.projects || []).slice(0, 2).map(x => `${x.name}: ${(x.bullets || [])[0] || ''}`);
  const skills = (p.skills || []).flatMap(s => s.items || []).slice(0, 10).join(', ');
  return [...exp, ...proj, skills && `Skills: ${skills}`].filter(Boolean).join('\n');
}

export function templateMessages({ personName, me: myName, school, company, role, isConnection }) {
  const first = str(personName).split(/\s+/)[0] || 'there';
  const who = `${myName || 'a student'}${school ? ` at ${school}` : ''}`;
  const ask = role ? `I'm applying for the ${role.title} role and would really value a referral or a pointer to the right person.` : `I'd love to hear how you got into ${company} and what the team looks for in interns and new grads.`;
  const note = `Hi ${first}, I'm ${who}. ${ask} Thank you!`.slice(0, 300);
  const body = `Hi ${first},\n\nI'm ${who}${isConnection ? ', and we’re connected on LinkedIn' : ''}. ${ask}${role?.url ? `\n\nThe posting: ${role.url}` : ''}\n\nThanks so much for your time,\n${myName || ''}`.trim();
  return { note, subject: role ? `Referral for ${role.title}?` : `Quick question about ${company}`, body };
}

/** Draft (or redraft) one person's LinkedIn note + email and save it on their contact. */
export async function writeFor(userId, key, ref) {
  const data = await companyPeople(userId, key);
  const p = data.people.find(x => x.ref === ref);
  if (!p) throw Object.assign(new Error('Person not found'), { status: 404 });
  let contactId = p.contactId;
  if (!contactId) {
    const conn = await one('SELECT * FROM linkedin_connections WHERE id = $1 AND user_id = $2', [p.connectionId, userId]);
    const jobId = await companyRow(userId, data.name, null);
    contactId = (await contactFor(userId, jobId, conn)).id;
  }
  const who = await me(userId);
  const ctx = { personName: p.name, me: who.name, school: who.school, company: data.name, role: data.role, isConnection: p.isConnection };
  let draft;
  try {
    const r = await complete({
      task: 'email',
      json: true,
      maxTokens: 1200,
      userId,
      system: `You write personalized outreach from a student or new grad to one person at a company.
Return JSON: {"note": "...", "subject": "...", "body": "..."}
- note: a LinkedIn message under 280 characters. body: an email under 120 words. subject: under 60 characters.
- Open with their first name. Mention one specific thing from STUDENT.background that fits their team or the role.
- Use only facts given. Describe the student only with STUDENT (don't guess their year or level). Describe the other person only by THEIR TITLE; don't claim what they work on.
- If ROLE is given: ask for a referral for it, or a pointer to the right person, and include the link in the email. If not: ask for 15 minutes about their team and how they hire interns/new grads.
- ${p.isConnection ? 'They are already a LinkedIn connection: warm, direct.' : 'They don’t know the student: brief and respectful.'} No flattery, no "I hope this finds you well".`,
      user: JSON.stringify({ to: p.name, theirTitle: p.title, company: data.name, ROLE: data.role, STUDENT: { name: who.name, school: who.school, background: await candidateHighlights(userId) } }),
    });
    const d = JSON.parse(String(r.text).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, ''));
    if (!str(d.note) || !str(d.body)) throw new Error('empty');
    draft = { note: str(d.note).slice(0, 300), subject: str(d.subject).slice(0, 120) || templateMessages(ctx).subject, body: str(d.body) };
  } catch (err) {
    if (err.status === 402) throw err;
    draft = templateMessages(ctx);
  }
  await run(
    `UPDATE job_contacts SET generated_dm = $2, generated_subject = $3, generated_body = $4,
            status = CASE WHEN COALESCE(status, 'pending') = 'pending' THEN 'generated' ELSE status END
      WHERE id = $1 AND user_id = $5`,
    [contactId, draft.note, draft.subject, draft.body, userId],
  );
  return (await companyPeople(userId, key)).people.find(x => x.contactId === contactId) || null;
}

/** Draft everyone at a company who doesn't have a message yet (at most 15 per call). */
export async function writeAll(userId, key) {
  const data = await companyPeople(userId, key);
  let n = 0;
  for (const p of data.people.filter(x => !x.note).slice(0, 15)) {
    await writeFor(userId, key, p.ref);
    n += 1;
  }
  return { written: n, ...(await companyPeople(userId, key)) };
}
