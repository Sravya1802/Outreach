/**
 * People → Contacts: the companies you're reaching out to. Open one to see,
 * per person, the email planned for them (waiting for your OK, scheduled or
 * sent) and the LinkedIn note that goes with it. Everyone else found at the
 * company is listed underneath.
 */

import { all } from '../db.js';
import { listOutbox } from './outbox.js';

const keyOf = (name) => String(name ?? '').trim().toLowerCase();

/** Companies with people, planned emails or LinkedIn notes; the ones waiting on you first. */
export async function planCompanies(userId) {
  const [people, mail, notes] = await Promise.all([
    all(
      `SELECT lower(trim(j.name)) AS key, max(j.name) AS name, COUNT(*)::int AS n, max(c.id) AS latest
         FROM job_contacts c JOIN jobs j ON j.id = c.job_id
        WHERE c.user_id = $1 GROUP BY 1`,
      [userId],
    ),
    all(
      `SELECT lower(trim(j.name)) AS key,
              COUNT(*) FILTER (WHERE o.status = 'draft')::int AS waiting,
              COUNT(*) FILTER (WHERE o.status IN ('scheduled', 'sending'))::int AS scheduled,
              COUNT(*) FILTER (WHERE o.status = 'sent')::int AS sent
         FROM email_outbox o JOIN job_contacts c ON c.id = o.contact_id JOIN jobs j ON j.id = c.job_id
        WHERE o.user_id = $1 AND o.step = 0 GROUP BY 1`,
      [userId],
    ),
    all(
      `SELECT lower(trim(COALESCE(j.name, pi.company_name))) AS key, max(COALESCE(j.name, pi.company_name)) AS name,
              COUNT(*) FILTER (WHERE a.status = 'to_send')::int AS to_send,
              COUNT(*) FILTER (WHERE a.status IN ('marked_sent', 'replied'))::int AS sent
         FROM referral_asks a JOIN plan_items pi ON pi.id = a.plan_item_id
         LEFT JOIN job_contacts c ON c.id = a.contact_id LEFT JOIN jobs j ON j.id = c.job_id
        WHERE a.user_id = $1 AND a.channel IN ('linkedin', 'search') GROUP BY 1`,
      [userId],
    ),
  ]);
  return mergeCompanies({ people, mail, notes });
}

/** Pure: the three per-company counts merged into one row each, sorted. */
export function mergeCompanies({ people, mail, notes }) {
  const byKey = new Map();
  const row = (key, name) => {
    if (!key) return null;
    if (!byKey.has(key)) byKey.set(key, { key, name: name || key, people: 0, waiting: 0, scheduled: 0, sent: 0, notesToSend: 0, notesSent: 0, latest: 0 });
    return byKey.get(key);
  };
  for (const p of people) { const r = row(p.key, p.name); if (r) { r.name = p.name || r.name; r.people = p.n; r.latest = Number(p.latest) || 0; } }
  for (const m of mail) { const r = row(m.key); if (r) Object.assign(r, { waiting: m.waiting, scheduled: m.scheduled, sent: m.sent }); }
  for (const n of notes) { const r = row(n.key, n.name); if (r) Object.assign(r, { notesToSend: n.to_send, notesSent: n.sent }); }
  return [...byKey.values()]
    .sort((a, b) => (b.waiting + b.notesToSend) - (a.waiting + a.notesToSend) || b.latest - a.latest || a.name.localeCompare(b.name))
    .map(({ latest, ...r }) => r);
}

/** One company: every planned email with its LinkedIn note, then everyone else found there. */
export async function companyPlan(userId, key) {
  const k = keyOf(key);
  const contacts = await all(
    `SELECT c.id, c.name, c.title, c.email, c.email_status, c.linkedin_url, c.status, j.name AS company_name, j.id AS company_id
       FROM job_contacts c JOIN jobs j ON j.id = c.job_id
      WHERE c.user_id = $1 AND lower(trim(j.name)) = $2
      ORDER BY c.seniority_score DESC NULLS LAST, c.id`,
    [userId, k],
  );
  const asks = await all(
    `SELECT a.id, a.channel, a.person_name, a.person_title, a.linkedin_url, a.email, a.contact_id, a.message, a.status,
            pi.title AS role_title, pi.apply_url AS role_url, COALESCE(j.name, pi.company_name) AS company_name
       FROM referral_asks a JOIN plan_items pi ON pi.id = a.plan_item_id
       LEFT JOIN job_contacts c ON c.id = a.contact_id LEFT JOIN jobs j ON j.id = c.job_id
      WHERE a.user_id = $1 AND lower(trim(COALESCE(j.name, pi.company_name))) = $2
      ORDER BY a.id`,
    [userId, k],
  );
  const outbox = contacts.length ? await listOutbox(userId, { contactIds: contacts.map(c => c.id) }) : [];
  return { key: k, name: contacts[0]?.company_name || asks[0]?.company_name || key, ...groupPlan({ contacts, outbox, asks }) };
}

const EMAIL_ORDER = { draft: 0, failed: 1, scheduled: 2, sending: 2, sent: 3 };
const isProfile = (url) => /linkedin\.com\/in\//i.test(String(url || ''));

/** Pure: people with their planned email and LinkedIn note, best first, plus everyone else. */
export function groupPlan({ contacts, outbox, asks }) {
  const people = new Map();
  const byName = new Map();
  const add = (ref, base) => {
    if (!people.has(ref)) {
      people.set(ref, { ref, email: null, note: null, role: null, ...base });
      if (base.name) byName.set(keyOf(base.name), ref);
    }
    return people.get(ref);
  };
  for (const c of contacts) {
    add(`c:${c.id}`, {
      contactId: c.id, name: c.name || 'Unknown name', title: c.title || null, address: c.email || null,
      addressCheck: c.email_status || null, linkedinUrl: isProfile(c.linkedin_url) ? c.linkedin_url : null, contactStatus: c.status || 'pending',
    });
  }
  // The first email to each person (a discarded one isn't planned); the latest wins.
  for (const o of outbox) {
    if (o.step !== 0 || o.status === 'cancelled' || !o.contact_id) continue;
    const p = people.get(`c:${o.contact_id}`);
    if (p && (!p.email || o.id > p.email.id)) p.email = o;
  }
  let search = null;
  for (const a of asks) {
    if (a.channel === 'search') {
      if (!search || a.status === 'to_send') search = { id: a.id, message: a.message, status: a.status, linkedinUrl: a.linkedin_url };
      continue;
    }
    const ref = a.contact_id && people.has(`c:${a.contact_id}`) ? `c:${a.contact_id}` : byName.get(keyOf(a.person_name)) || `n:${keyOf(a.person_name)}`;
    const p = people.get(ref) || add(ref, {
      contactId: a.contact_id || null, name: a.person_name || 'Someone', title: a.person_title || null, address: a.email || null,
      addressCheck: null, linkedinUrl: isProfile(a.linkedin_url) ? a.linkedin_url : null, contactStatus: 'pending',
    });
    if (a.role_title && !p.role) p.role = { title: a.role_title, url: a.role_url || null };
    if (a.channel === 'linkedin' && (!p.note || (p.note.status !== 'to_send' && a.status === 'to_send'))) {
      p.note = { id: a.id, message: a.message, status: a.status, linkedinUrl: p.linkedinUrl || a.linkedin_url || null };
    }
  }
  const all = [...people.values()];
  const planned = all
    .filter(p => p.email || p.note)
    .sort((a, b) => (a.email ? EMAIL_ORDER[a.email.status] ?? 4 : 5) - (b.email ? EMAIL_ORDER[b.email.status] ?? 4 : 5)
      || Number(b.note?.status === 'to_send') - Number(a.note?.status === 'to_send'));
  const others = all.filter(p => !p.email && !p.note)
    .map(({ email, note, role, ...p }) => p);
  const roles = new Map();
  for (const a of asks) {
    if (a.role_title && !roles.get(a.role_title)?.url) roles.set(a.role_title, { title: a.role_title, url: a.role_url || null });
  }
  return { roles: [...roles.values()], search, planned, others };
}
