/**
 * roleDashboard.js — the To apply dashboard: one card per role Claude has
 * tailored, with its resume, its people (the same data as People → Contacts)
 * and how to apply, so a role never needs the People tab to be worked on.
 *
 * dashboardRoles: a one-line summary per role (from the cached Review queue
 * plus a few grouped queries, one round trip each, run together).
 * roleCard: everything for one card when it's opened.
 */

import { all, one, run } from '../db.js';
import { normalizeQuestion } from './answerBank.js';
import { readyRoles } from './readyToSubmit.js';
import { reviewQueue, reviewRole } from './tailorPipeline.js';

const fail = (status, message) => Object.assign(new Error(message), { status });
const str = (v) => String(v ?? '').trim();
const DAY = 86_400_000;

/** The card's chip, from where the role is. Pure. */
export function chipFor(r) {
  if (r.status === 'closed') return 'Closed';
  if (r.status === 'applied' || ['applied', 'referred', 'done'].includes(r.stage)) return 'Applied';
  if (r.replies > 0) return 'Replied';
  if (r.sent > 0) return 'Emailed';
  if (r.status === 'approved') return 'Approved';
  return 'Review';
}

/** Days until a date-only deadline, from `now` (UTC days). Pure. */
export function daysUntil(deadline, now = new Date()) {
  if (!deadline) return null;
  const [y, m, d] = String(deadline).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / DAY);
}

/** Which of the top counts a card belongs to. Pure. */
export function groupsOf(card, now = new Date()) {
  const g = [];
  if (['ready', 'revision_requested'].includes(card.status)) g.push('review');
  if (card.status === 'approved') g.push('approved');
  if (card.sent > 0) g.push('emailed');
  if (card.replies > 0) g.push('replies');
  if (card.submit) g.push('submit');
  if (card.chip === 'Applied') g.push('applied');
  const left = daysUntil(card.deadline, now);
  if (left != null && left >= 0 && left <= 7 && !['Applied', 'Closed'].includes(card.chip)) g.push('closing');
  return g;
}

/** Deadline first (soonest; none last), then callback % (highest first). Pure. */
export function sortCards(cards) {
  const dl = (c) => (c.deadline ? Date.parse(`${String(c.deadline).slice(0, 10)}T00:00:00Z`) : Infinity);
  return [...cards].sort((a, b) => dl(a) - dl(b) || (Number(b.callback) || 0) - (Number(a.callback) || 0) || String(a.company).localeCompare(String(b.company)));
}

export async function dashboardRoles(userId) {
  const [queue, outreach, mail, notes, replies, items, ready] = await Promise.all([
    reviewQueue(userId),
    all(
      `SELECT d.plan_item_id::text AS id, COUNT(*)::int AS people,
              COUNT(*) FILTER (WHERE d.status IN ('draft', 'edited') AND COALESCE(btrim(d.email_body), '') <> '' AND c.email_status = 'valid')::int AS to_approve,
              COUNT(*) FILTER (WHERE d.status IN ('draft', 'edited') AND COALESCE(btrim(c.email), '') <> '' AND c.email_status = 'valid' AND COALESCE(btrim(d.email_body), '') = '')::int AS writing
         FROM outreach_drafts d LEFT JOIN job_contacts c ON c.id = d.contact_id
        WHERE d.user_id = $1 AND d.status <> 'closed' GROUP BY 1`,
      [userId],
    ),
    all(
      `SELECT a.plan_item_id::text AS id,
              COUNT(*) FILTER (WHERE o.status IN ('scheduled', 'sending'))::int AS scheduled,
              COUNT(*) FILTER (WHERE o.status = 'draft')::int AS in_outbox,
              COUNT(*) FILTER (WHERE o.status = 'sent')::int AS sent,
              MIN(o.send_after) FILTER (WHERE o.status = 'scheduled') AS first_send,
              MAX(o.send_after) FILTER (WHERE o.status = 'scheduled') AS last_send
         FROM referral_asks a JOIN email_outbox o ON o.id = a.outbox_id
        WHERE a.user_id = $1 AND a.channel = 'email' GROUP BY 1`,
      [userId],
    ),
    all(
      `SELECT plan_item_id::text AS id, COUNT(*) FILTER (WHERE status = 'to_send')::int AS to_send, COUNT(*) FILTER (WHERE status IN ('marked_sent', 'replied'))::int AS sent
         FROM referral_asks WHERE user_id = $1 AND channel = 'linkedin' GROUP BY 1`,
      [userId],
    ),
    all(
      `SELECT x.id, COUNT(DISTINCT r.id) FILTER (WHERE r.kind IN ('reply', 'linkedin_message'))::int AS replies,
              COUNT(DISTINCT r.id) FILTER (WHERE r.kind = 'bounce')::int AS bounces
         FROM (SELECT DISTINCT plan_item_id::text AS id, contact_id FROM referral_asks WHERE user_id = $1 AND contact_id IS NOT NULL) x
         JOIN email_replies r ON r.contact_id = x.contact_id AND r.user_id = $1 GROUP BY 1`,
      [userId],
    ),
    all(
      `SELECT pi.id::text AS id, pi.stage, pi.evaluation_id, pi.apply_url FROM plan_items pi JOIN tailor_jobs j ON j.plan_item_id = pi.id
        WHERE j.user_id = $1 AND j.status IN ('ready', 'revision_requested', 'approved', 'applied', 'closed')`,
      [userId],
    ),
    readyRoles(userId, { resolve: false }),
  ]);
  const by = (rows) => new Map(rows.map(r => [String(r.id), r]));
  const [O, M, N, R, I, S] = [by(outreach), by(mail), by(notes), by(replies), by(items), by(ready)];
  const now = new Date();
  const cards = queue.filter(r => r.version != null).map((r) => {
    const id = String(r.id);
    const o = O.get(id) || {};
    const m = M.get(id) || {};
    const n = N.get(id) || {};
    const rp = R.get(id) || {};
    const it = I.get(id) || {};
    const s = S.get(id);
    const card = {
      id, company: r.company_name, title: r.title, location: r.location, deadline: r.deadline, posted_at: r.posted_at,
      kind: r.role_kind, status: r.status, stage: it.stage || null, closed_reason: r.closed_reason || null,
      ats: r.ats_after ?? null, callback: r.callback_after ?? null, version: r.version, version_id: r.version_id ? String(r.version_id) : null,
      check_status: r.check_status, pdf_pending: Boolean(r.pdf_pending), evaluation_id: it.evaluation_id ? String(it.evaluation_id) : null,
      apply_url: it.apply_url || null, referral_mode: r.referral_mode,
      people: o.people || 0, to_approve: o.to_approve || 0, writing: o.writing || 0,
      in_outbox: m.in_outbox || 0, scheduled: m.scheduled || 0, sent: m.sent || 0, first_send: m.first_send || null, last_send: m.last_send || null,
      notes_to_send: n.to_send || 0, notes_sent: n.sent || 0, replies: rp.replies || 0, bounces: rp.bounces || 0,
      submit: s ? { kind: s.kind, open_url: s.open_url, unanswered: s.unanswered || [], needs_you: s.answers?.needs_you || 0, posting_closed: Boolean(s.posting_closed) } : null,
    };
    card.chip = chipFor(card);
    card.groups = groupsOf(card, now);
    return card;
  });
  return { roles: sortCards(cards) };
}

/** Everything for one opened card: the role, its versions, each person with their email and note, replies, and what applying needs. */
export async function roleCard(userId, planItemId) {
  const [role, notes, replies, needs, ready, item] = await Promise.all([
    reviewRole(userId, planItemId),
    all(
      `SELECT id, contact_id, person_name, message, status, linkedin_url FROM referral_asks
        WHERE user_id = $1 AND plan_item_id = $2 AND channel = 'linkedin' ORDER BY id`,
      [userId, planItemId],
    ),
    all(
      `SELECT DISTINCT ON (r.contact_id) r.contact_id, r.kind, r.snippet, r.subject, r.received_at, r.from_email
         FROM email_replies r
        WHERE r.user_id = $1 AND r.contact_id IN (
          SELECT contact_id FROM referral_asks WHERE user_id = $1 AND plan_item_id = $2 AND contact_id IS NOT NULL
          UNION SELECT contact_id FROM outreach_drafts WHERE user_id = $1 AND plan_item_id = $2 AND contact_id IS NOT NULL)
        ORDER BY r.contact_id, r.received_at DESC`,
      [userId, planItemId],
    ),
    all(
      `SELECT question, note FROM role_answers WHERE user_id = $1 AND plan_item_id = $2 AND status = 'needs_you' ORDER BY required DESC, id`,
      [userId, planItemId],
    ),
    readyRoles(userId, { resolve: false }).then(list => list.find(r => r.id === String(planItemId)) || null),
    one('SELECT evaluation_id, apply_url, stage FROM plan_items WHERE id = $1 AND user_id = $2', [planItemId, userId]),
  ]);
  if (!role) throw fail(404, 'That role isn’t in your list.');
  const noteBy = new Map(notes.filter(n => n.contact_id).map(n => [String(n.contact_id), n]));
  const replyBy = new Map(replies.map(r => [String(r.contact_id), r]));
  const contactIds = (await all('SELECT id, contact_id FROM outreach_drafts WHERE user_id = $1 AND plan_item_id = $2', [userId, planItemId]))
    .reduce((m, d) => m.set(String(d.id), d.contact_id ? String(d.contact_id) : null), new Map());
  const people = role.outreach.map((d) => {
    const cid = contactIds.get(String(d.id));
    const note = (cid && noteBy.get(cid)) || null;
    const reply = (cid && replyBy.get(cid)) || null;
    return {
      draft_id: String(d.id), contact_id: cid, name: d.name, title: d.title, audience: d.audience, email: d.email, email_check: d.email_status,
      linkedin_url: d.linkedin_url, draft_status: d.status, writing: d.writing, subject: d.email_subject, body: d.email_body,
      outbox_status: d.outbox_status || null, send_after: d.send_after || null, recipient_tz: d.recipient_tz || null,
      note_text: note?.message || d.linkedin_note || null, note_status: note?.status || null, note_ask_id: note ? String(note.id) : null,
      reply: reply ? { kind: reply.kind, snippet: reply.snippet, subject: reply.subject, at: reply.received_at } : null,
      problems: d.problems || [],
    };
  });
  // Questions the form left (from the last fill) that aren't already a prepared answer.
  const asked = new Set(needs.map(n => normalizeQuestion(n.question)));
  const leftover = (ready?.unanswered || []).filter(q => !asked.has(normalizeQuestion(q))).map(q => ({ question: q, note: null }));
  return {
    role: role.role, versions: role.versions.map(v => ({ id: String(v.id), version: v.version, ats_after: v.ats_after, callback_after: v.callback_after, check_status: v.check_status, has_pdf: v.has_pdf, is_final: v.is_final })),
    comments: role.comments.filter(c => c.status === 'open').length,
    people, evaluation_id: item?.evaluation_id ? String(item.evaluation_id) : null,
    submit: ready ? { kind: ready.kind, open_url: ready.open_url, posting_closed: Boolean(ready.posting_closed) } : null,
    needs: [...needs, ...leftover].slice(0, 30),
  };
}

/** The user's answer to a question a form asked for this role: saved for the filler (and the run leaves it alone). */
export async function answerQuestion(userId, planItemId, { question, answer }) {
  const q = str(question).slice(0, 1000);
  const a = str(answer).slice(0, 4000);
  if (!q || !a) throw fail(400, 'Write an answer first.');
  if (!await one('SELECT 1 AS x FROM tailor_jobs WHERE user_id = $1 AND plan_item_id = $2', [userId, planItemId])) throw fail(404, 'That role isn’t in your list.');
  await run(
    `INSERT INTO role_answers (user_id, plan_item_id, question, question_key, answer, source, status, note)
     VALUES ($1, $2, $3, $4, $5, 'you', 'ready', NULL)
     ON CONFLICT (plan_item_id, question_key) DO UPDATE SET answer = EXCLUDED.answer, source = 'you', status = 'ready', note = NULL, updated_at = NOW()`,
    [userId, planItemId, q, normalizeQuestion(q), a],
  );
  // Gone from the "needs you" list the last fill left.
  await run(
    `UPDATE plan_items SET fill_report = jsonb_set(fill_report, '{unanswered}', COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements_text(fill_report->'unanswered') x WHERE x <> $3), '[]'::jsonb))
      WHERE id = $1 AND user_id = $2 AND fill_report ? 'unanswered'`,
    [planItemId, userId, q],
  );
  return { ok: true };
}

/** Every LinkedIn note for this role that's still to send, marked sent (you sent them by hand). */
export async function markRoleNotesSent(userId, planItemId) {
  const { markAskSent } = await import('./referralFlow.js');
  const asks = await all("SELECT id FROM referral_asks WHERE user_id = $1 AND plan_item_id = $2 AND channel = 'linkedin' AND status = 'to_send'", [userId, planItemId]);
  for (const a of asks) await markAskSent(userId, a.id);
  return { marked: asks.length };
}
