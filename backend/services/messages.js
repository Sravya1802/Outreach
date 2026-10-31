/**
 * messages.js — the People → Messages page: every company where the user has
 * someone (LinkedIn connections export + contacts found for them), the people
 * there, and a personalized LinkedIn note + email for each, drafted on demand
 * and saved on the contact (job_contacts.generated_*).
 */

import { all, one, run } from '../db.js';
import { complete } from './llm.js';
import { companyKey } from './linkedinConnections.js';
import { FORMAL, candidateHighlights, companyRow, contactFor, me, noteFit, postingUrl, schoolName, signature, signed } from './referralFlow.js';
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

export function templateMessages({ personName, me: myName, school, sig, company, role, isConnection }) {
  const first = str(personName).split(/\s+/)[0] || 'there';
  const who = `${myName || 'a student'}${school ? `, a student at ${schoolName(school)}` : ''}`;
  const ask = role
    ? `I am applying for the ${role.title} position at ${company}. Would you be willing to refer me, or direct me to the appropriate person on the hiring team?`
    : `I would appreciate the chance to learn how you joined ${company} and what the team looks for in interns and new graduates.`;
  const note = noteFit(`Hello ${first}, I am ${who}. ${ask} Thank you.`);
  const body = `Dear ${first},\n\nMy name is ${who}${isConnection ? ', and we are connected on LinkedIn' : ''}. ${ask}${role?.url ? `\n\nThe job posting is available here: ${postingUrl(role.url)}` : ''}\n\nThank you for your time and consideration.`;
  return { note, subject: role ? `Referral request: ${role.title} at ${company}`.slice(0, 120) : `Question about ${company}`, body: signed(body, myName, sig) };
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
  const ctx = { personName: p.name, me: who.name, school: who.school, sig: signature(who), company: data.name, role: data.role, isConnection: p.isConnection };
  let draft;
  try {
    const r = await complete({
      task: 'email',
      json: true,
      maxTokens: 1200,
      userId,
      system: `You write personalized outreach from a student or new grad to one person at a company.
Return JSON: {"note": "...", "subject": "...", "body": "..."}
- note: a LinkedIn message under 250 characters, starting "Hello <first name>,", formal with no contractions, with no link and no mention of a résumé or attachment. body: an email under 120 words. subject: under 60 characters.
- ${FORMAL}
- Mention one specific thing from STUDENT.background (a project, internship or result, with a concrete detail) that fits the role.
- Use only facts given. Describe the student only with STUDENT (don't guess their year or level). Describe the other person only by THEIR TITLE; don't claim what they work on or what their team focuses on.
- If ROLE is given: ask whether they would be willing to refer the student, or direct them to the appropriate person, and give the link as a sentence ("The job posting is available here: <link>"). If not: ask for 15 minutes to learn about their team and how they hire interns and new graduates.
- ${p.isConnection ? 'They are already a LinkedIn connection: you may mention that, in the same formal tone.' : 'They don’t know the student: brief and respectful.'}`,
      user: JSON.stringify({ to: p.name, theirTitle: p.title, company: data.name, ROLE: data.role && { ...data.role, url: postingUrl(data.role.url) }, STUDENT: { name: who.name, major: who.major, school: who.school, background: await candidateHighlights(userId) } }),
    });
    const d = JSON.parse(String(r.text).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, ''));
    if (!str(d.note) || !str(d.body)) throw new Error('empty');
    draft = { note: noteFit(d.note), subject: str(d.subject).slice(0, 120) || templateMessages(ctx).subject, body: signed(d.body, who.name, ctx.sig) };
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
