/**
 * referrers.js — the people the user can ask at a company. Roles there skip
 * recruiter outreach: new queue rows start on My contact (a trigger, migration 042)
 * and roles not yet approved move to it here. The Role page can still change a role.
 */
import { all, one, run } from '../db.js';

const fail = (status, message) => Object.assign(new Error(message), { status });
const clean = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export async function listReferrers(userId) {
  return all(
    `SELECT r.id, r.company_name, r.contact_name, r.note,
            (SELECT COUNT(*)::int FROM tailor_jobs j JOIN plan_items pi ON pi.id = j.plan_item_id
              WHERE j.user_id = r.user_id AND lower(trim(pi.company_name)) = lower(r.company_name)) AS roles
       FROM referrers r WHERE r.user_id = $1 ORDER BY lower(r.company_name)`,
    [userId],
  );
}

export async function addReferrer(userId, { company_name, contact_name, note }) {
  const company = clean(company_name, 120);
  const contact = clean(contact_name, 120);
  if (!company || !contact) throw fail(400, 'Add the company and who can refer you.');
  const saved = await one(
    `INSERT INTO referrers (user_id, company_name, contact_name, note) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, lower(company_name)) DO UPDATE SET contact_name = EXCLUDED.contact_name, note = EXCLUDED.note RETURNING *`,
    [userId, company, contact, clean(note, 300) || null],
  );
  const moved = await run(
    `UPDATE tailor_jobs j SET referral_mode = 'my_contact', updated_at = NOW() FROM plan_items pi
      WHERE pi.id = j.plan_item_id AND j.user_id = $1 AND lower(trim(pi.company_name)) = lower($2)
        AND j.status IN ('queued', 'in_progress', 'ready', 'revision_requested') AND j.referral_mode <> 'my_contact'`,
    [userId, company],
  );
  return { referrer: saved, moved: moved.rowCount };
}

export async function removeReferrer(userId, id) {
  await run('DELETE FROM referrers WHERE user_id = $1 AND id = $2', [userId, id]);
}
