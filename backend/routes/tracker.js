// Applications → Tracker: every application as a sheet the user can monitor
// and edit (company, role, link, submitted, status, referral), plus a CSV
// import of their own spreadsheet and a CSV download in the same columns.
import { Router } from 'express';
import { all, one, run } from '../db.js';
import { parseId } from '../services/safePaths.js';
import { sheetRows, toApplyStatus, toReferral, matchKey, isSent, referralFromPlan, toCsv, STATUS_LABEL } from '../services/trackerSheet.js';

const router = Router();

const STATUSES = ['not_started', 'submitted', 'responded', 'interview', 'offer', 'rejected'];
const REFERRALS = ['yes', 'no', 'not_required', 'asked'];
const MAX_IMPORT_ROWS = 2000;
const TITLE_KEY = 'tracker_title';
const DEFAULT_TITLE = 'MY APPLICATIONS';

async function titleFor(userId) {
  return (await one('SELECT value FROM meta WHERE user_id = $1 AND key = $2', [userId, TITLE_KEY]))?.value || DEFAULT_TITLE;
}
async function setTitle(userId, title) {
  await run('INSERT INTO meta (user_id, key, value) VALUES ($1, $2, $3) ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value', [userId, TITLE_KEY, title]);
}

const str = (v, max = 300) => String(v ?? '').trim().slice(0, max);
const fail = (res, err) => {
  if (!err.status || err.status >= 500) console.error('[tracker]', err.message);
  res.status(err.status || 500).json({ error: err.message });
};
const bad = (message) => Object.assign(new Error(message), { status: 400 });

function cleanLink(v) {
  const s = str(v, 1000);
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) throw bad('The link must start with http:// or https://');
  try { return new URL(s).href; } catch { throw bad('That link isn’t a valid URL'); }
}

async function rowsFor(userId) {
  const rows = await all(
    `SELECT e.id, e.company_name, e.job_title, e.job_url, e.apply_status, e.apply_mode, e.applied_at, e.referral_status, e.source,
            e.created_at, e.stage_changed_at,
            (SELECT pi.referral_status FROM plan_items pi WHERE pi.evaluation_id = e.id AND pi.user_id = e.user_id ORDER BY pi.id DESC LIMIT 1) AS plan_referral
       FROM evaluations e WHERE e.user_id = $1
      ORDER BY COALESCE(e.stage_changed_at, e.created_at) DESC, e.id DESC`,
    [userId],
  );
  return rows.map(r => ({
    id: Number(r.id),
    company_name: r.company_name,
    job_title: r.job_title,
    job_url: r.job_url,
    apply_status: STATUSES.includes(r.apply_status) ? r.apply_status : (isSent(r.apply_status) ? r.apply_status : 'not_started'),
    raw_status: r.apply_status,
    submitted: isSent(r.apply_status),
    status_label: STATUS_LABEL[r.apply_status] ?? '',
    referral: r.referral_status || referralFromPlan(r.plan_referral),
    referral_set: r.referral_status || null,
    by_app: r.apply_mode === 'auto' || r.source === 'daily_plan',
    source: r.source,
    applied_at: r.applied_at,
    updated_at: r.stage_changed_at || r.created_at,
  }));
}

router.get('/', async (req, res) => {
  try { res.json({ rows: await rowsFor(req.user.id), title: await titleFor(req.user.id) }); } catch (err) { fail(res, err); }
});

// The banner above the sheet ("2027 NEW GRAD ROLES APPLICATION").
router.put('/title', async (req, res) => {
  try {
    const title = str(req.body?.title, 120);
    if (!title) throw bad('Give the sheet a title');
    await setTitle(req.user.id, title);
    res.json({ title });
  } catch (err) { fail(res, err); }
});

// A row added by hand (an application made outside the app).
router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    const company = str(b.company, 200);
    const role = str(b.role, 300);
    if (!company || !role) throw bad('Add a company and a role');
    const status = STATUSES.includes(b.status) ? b.status : (b.submitted ? 'submitted' : 'not_started');
    const referral = REFERRALS.includes(b.referral) ? b.referral : null;
    const row = (await run(
      `INSERT INTO evaluations (user_id, company_name, job_title, job_url, apply_mode, apply_status, applied_at, stage_changed_at, referral_status, source)
       VALUES ($1, $2, $3, $4, 'manual', $5, CASE WHEN $6 THEN NOW()::text END, NOW(), $7, 'tracker') RETURNING id`,
      [req.user.id, company, role, cleanLink(b.link), status, isSent(status), referral],
    )).rows[0];
    res.status(201).json({ id: Number(row.id) });
  } catch (err) { fail(res, err); }
});

// Change one cell: company, role, link, submitted, status or referral.
router.patch('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad id' });
  try {
    const cur = await one('SELECT id, apply_status FROM evaluations WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    if (!cur) return res.status(404).json({ error: 'Not found' });
    const b = req.body || {};
    const sets = [];
    const vals = [id, req.user.id];
    const set = (sql, v) => { vals.push(v); sets.push(sql.replace('?', `$${vals.length}`)); };
    if ('company' in b) { const v = str(b.company, 200); if (!v) throw bad('The company can’t be empty'); set('company_name = ?', v); }
    if ('role' in b) { const v = str(b.role, 300); if (!v) throw bad('The role can’t be empty'); set('job_title = ?', v); }
    if ('link' in b) set('job_url = ?', cleanLink(b.link));
    let status = null;
    if ('status' in b) {
      if (!STATUSES.includes(b.status)) throw bad(`status must be one of ${STATUSES.join(', ')}`);
      status = b.status;
    } else if ('submitted' in b) {
      status = b.submitted ? (isSent(cur.apply_status) ? null : 'submitted') : 'not_started';
    }
    if (status && status !== cur.apply_status) {
      set('apply_status = ?', status);
      sets.push('stage_changed_at = NOW()');
      sets.push(isSent(status) ? 'applied_at = COALESCE(applied_at, NOW()::text)' : 'applied_at = NULL');
    }
    if ('referral' in b) {
      if (b.referral !== null && !REFERRALS.includes(b.referral)) throw bad(`referral must be one of ${REFERRALS.join(', ')}`);
      set('referral_status = ?', b.referral);
    }
    if (sets.length) await run(`UPDATE evaluations SET ${sets.join(', ')} WHERE id = $1 AND user_id = $2`, vals);
    res.json({ row: (await rowsFor(req.user.id)).find(r => r.id === id) });
  } catch (err) { fail(res, err); }
});

// Import a CSV export of the user's own sheet. Rows already here (same link,
// or same company and role) take the sheet's status and referral; new ones are added.
export async function importSheet(userId, csv) {
  if (!String(csv || '').trim()) throw bad('Choose the CSV you downloaded from your sheet');
  if (csv.length > 3_000_000) throw bad('That file is too large');
  const { rows, title, error } = sheetRows(csv);
  if (error) throw bad(error);
  if (rows.length > MAX_IMPORT_ROWS) throw bad(`That sheet has ${rows.length} rows; the most an import takes is ${MAX_IMPORT_ROWS}.`);
  // Take the sheet's own title banner, unless one was already set here.
  if (title && (await titleFor(userId)) === DEFAULT_TITLE) await setTitle(userId, title);
  const existing = await all('SELECT id, company_name, job_title, job_url, apply_status, referral_status FROM evaluations WHERE user_id = $1', [userId]);
  const byKey = new Map();
  for (const e of existing) {
    byKey.set(matchKey({ company: e.company_name, role: e.job_title, link: e.job_url }), e);
    byKey.set(matchKey({ company: e.company_name, role: e.job_title }), e);
  }
  let added = 0, updated = 0, unchanged = 0;
  const skipped = [];
  for (const r of rows) {
    if (!r.company || !r.role) { skipped.push(`${r.company || r.role}: needs both a company and a role`); continue; }
    const status = toApplyStatus(r.submitted, r.status);
    const referral = toReferral(r.referral);
    let link = null;
    try { link = r.link ? cleanLink(r.link) : null; } catch { link = null; }
    const hit = byKey.get(matchKey({ ...r, link })) || byKey.get(matchKey({ company: r.company, role: r.role }));
    if (hit) {
      const nextStatus = status === 'not_started' && isSent(hit.apply_status) ? hit.apply_status : status;
      const nextReferral = referral ?? hit.referral_status;
      if (nextStatus === hit.apply_status && nextReferral === hit.referral_status) { unchanged += 1; continue; }
      await run(
        `UPDATE evaluations SET apply_status = $3, referral_status = $4,
                stage_changed_at = CASE WHEN apply_status <> $3 THEN NOW() ELSE stage_changed_at END,
                applied_at = CASE WHEN $5 THEN COALESCE(applied_at, NOW()::text) ELSE applied_at END,
                job_url = COALESCE(job_url, $6)
          WHERE id = $1 AND user_id = $2`,
        [hit.id, userId, nextStatus, nextReferral, isSent(nextStatus), link],
      );
      Object.assign(hit, { apply_status: nextStatus, referral_status: nextReferral });
      updated += 1;
      continue;
    }
    const ins = (await run(
      `INSERT INTO evaluations (user_id, company_name, job_title, job_url, apply_mode, apply_status, applied_at, stage_changed_at, referral_status, source)
       VALUES ($1, $2, $3, $4, 'manual', $5, CASE WHEN $6 THEN NOW()::text END, NOW(), $7, 'sheet_import') RETURNING id`,
      [userId, str(r.company, 200), str(r.role, 300), link, status, isSent(status), referral],
    )).rows[0];
    const row = { id: ins.id, company_name: r.company, job_title: r.role, job_url: link, apply_status: status, referral_status: referral };
    byKey.set(matchKey({ ...r, link }), row);
    byKey.set(matchKey({ company: r.company, role: r.role }), row);
    added += 1;
  }
  return { total: rows.length, added, updated, unchanged, skipped };
}

router.post('/import', async (req, res) => {
  try { res.json(await importSheet(req.user.id, typeof req.body?.csv === 'string' ? req.body.csv : '')); } catch (err) { fail(res, err); }
});

// The tracker as a CSV in the sheet's columns (File → Import in Google Sheets).
router.get('/export.csv', async (req, res) => {
  try {
    const csv = toCsv(await rowsFor(req.user.id));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="applications-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  } catch (err) { fail(res, err); }
});

export default router;
