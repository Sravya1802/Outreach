// Every Roles-tab role goes to the Claude chat runs on its own: no pick step.
//
//   readRolesTabPostings  reads each role's posting once: its text (saved, so
//                         a run has it), the deadline it states, whether an
//                         internship wants returning students (those drop off
//                         the Roles tab), and whether it has closed.
//   fillQueue             one queued role per company + title (locations
//                         grouped), skipping roles already queued, skipped,
//                         approved or applied.
//   prioritizeQueue       tailor_jobs.priority, which claim_tailor_jobs picks
//                         by (at most the day's cap of new roles): stated
//                         deadlines in the next 7 days first, soonest first,
//                         then newest and oldest roles alternating. A role
//                         older than 14 days is confirmed open before its turn.
//   pullInDeadlines       an approved role whose deadline comes before the
//                         referral wait ends applies at the next morning slot.
//
// Nothing here applies, emails or drafts anything: approval stays the user's.
import { all, one, run } from '../db.js';
import { postingFacts } from './postingFacts.js';

import { DAY, OFF_FIELD_NOTE, OLD_DAYS, RECHECK_DAYS, SOON_DAYS, day, groupRoles, key, offFieldReason, queueOrder, rolesTabWhere, time } from './queueOrder.js';

export { groupRoles, queueOrder, rolesTabWhere };

/**
 * Is the posting still taking applications? true / false, or null when it
 * can't tell (then it stays in line). Greenhouse, Lever, Ashby, Workday, iCIMS
 * and the rest through the posting reader; LinkedIn through its guest API.
 */
export async function postingOpen(url) {
  const { fetchJobFromUrl, linkedInJobId } = await import('./jobEvaluator.js');
  const id = linkedInJobId(url);
  if (id) {
    try {
      const res = await fetch(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36', Accept: 'text/html' },
        signal: AbortSignal.timeout(10000),
      });
      if (res.status === 404 || res.status === 410) return false;
      if (!res.ok) return null;
      const html = await res.text();
      if (/no longer accepting applications/i.test(html)) return false;
      return /show-more-less-html__markup|description__text/.test(html) ? true : null;
    } catch { return null; }
  }
  const r = await fetchJobFromUrl(url).catch(() => null);
  if (!r) return null;
  if (r.closed || /closed|removed|no longer (accepting|available)/i.test(r.error || '')) return false;
  return r.text ? true : null;
}

async function mapLimit(items, limit, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

// Sites that turn automated readers away: their postings aren't fetched again.
const NO_READER = String.raw`lifeattiktok\.com`;

/** Enough of a posting for a run to write a resume from (the same bar claim_tailor_jobs uses). */
export const HAS_POSTING_SQL = "GREATEST(length(COALESCE(pi.job_description, '')), length(COALESCE(sr.description, ''))) > 200";

/**
 * Read the Roles tab's postings that haven't been read: text saved where the
 * row had none, deadline, return-to-school, closed (the role leaves the Roles
 * tab). LinkedIn one at a time, gently; everything else four at a time.
 * `retry`: postings read before without getting their text, once a day each.
 */
export async function readRolesTabPostings({ limit = 500, log = console, read, retry = false } = {}) {
  const w = rolesTabWhere(1, { keepReturnToSchool: true });
  const which = retry
    ? `facts_read_at < NOW() - INTERVAL '1 day' AND length(COALESCE(description, '')) <= 200 AND apply_url IS NOT NULL AND apply_url !~* '${NO_READER}'`
    : 'facts_read_at IS NULL';
  const rows = await all(
    `SELECT id, role_type, apply_url, COALESCE(posted_at, scraped_at) AS posted, length(COALESCE(description, '')) > 200 AS has_text
       FROM scraped_roles WHERE ${w.sql} AND ${which}
      ORDER BY facts_read_at NULLS FIRST, COALESCE(posted_at, scraped_at) DESC LIMIT $${w.params.length + 1}`,
    [...w.params, limit],
  );
  const stats = { read: 0, fromStored: 0, fetched: 0, closed: 0, unreadable: 0, returnToSchool: 0, deadlines: 0, closedIds: [], returnToSchoolIds: [] };
  const pending = [];
  const flush = async () => {
    if (!pending.length) return;
    const b = pending.splice(0);
    await run(
      `UPDATE scraped_roles s SET
          description = CASE WHEN length(COALESCE(s.description, '')) > 200 THEN s.description ELSE COALESCE(u.text, s.description) END,
          apply_deadline = u.deadline::date, return_to_school = u.rts,
          is_active = CASE WHEN u.closed THEN 0 ELSE s.is_active END, facts_read_at = NOW()
        FROM unnest($1::bigint[], $2::text[], $3::text[], $4::boolean[], $5::boolean[]) AS u(id, text, deadline, rts, closed)
       WHERE s.id = u.id`,
      [b.map(x => x.id), b.map(x => x.text), b.map(x => x.deadline), b.map(x => x.rts), b.map(x => x.closed)],
    );
  };
  const done = async (r, { text = null, closed = false }) => {
    const f = text ? postingFacts(text, { roleType: r.role_type, posted: r.posted }) : { deadline: null, returnToSchool: null };
    stats.read += 1;
    if (closed) { stats.closed += 1; stats.closedIds.push(String(r.id)); }
    if (!text && !closed) stats.unreadable += 1;
    if (f.returnToSchool) { stats.returnToSchool += 1; stats.returnToSchoolIds.push(String(r.id)); }
    if (f.deadline) stats.deadlines += 1;
    pending.push({ id: r.id, text: text ? String(text).slice(0, 20000) : null, deadline: f.deadline, rts: text ? f.returnToSchool : null, closed });
    if (pending.length >= 50) await flush();
  };

  // Text already saved with the row.
  const stored = rows.filter(r => r.has_text);
  for (let i = 0; i < stored.length; i += 200) {
    const chunk = stored.slice(i, i + 200);
    const texts = new Map((await all('SELECT id, description FROM scraped_roles WHERE id = ANY($1)', [chunk.map(r => r.id)])).map(t => [String(t.id), t.description]));
    for (const r of chunk) { stats.fromStored += 1; await done(r, { text: texts.get(String(r.id)) }); }
  }

  // The rest from the posting itself.
  const { fetchJobFromUrl, linkedInJobId } = await import('./jobEvaluator.js');
  const fetchIt = read || (async (url) => fetchJobFromUrl(url).catch(() => null));
  const toFetch = rows.filter(r => !r.has_text && r.apply_url);
  const linkedin = toFetch.filter(r => linkedInJobId(r.apply_url));
  const others = toFetch.filter(r => !linkedInJobId(r.apply_url));
  const one_ = async (r) => {
    const got = await fetchIt(r.apply_url);
    stats.fetched += 1;
    const closed = Boolean(got?.closed);
    await done(r, { text: !closed && got?.text ? got.text : null, closed });
    if (stats.read % 100 === 0) log.log?.(`[queue] read ${stats.read} of ${rows.length}`);
  };
  await Promise.all([
    mapLimit(others, 4, one_),
    (async () => { for (const r of linkedin) { await one_(r); await new Promise(res => setTimeout(res, 1200)); } })(),
  ]);
  await flush();
  return { ...stats, due: rows.length };
}

/**
 * A posting read after its role was queued turned out closed, or an internship
 * for students returning to school: the role leaves the queue (not one a run
 * is writing, or has written).
 */
export async function dropFromQueue({ closedIds = [], returnToSchoolIds = [] }) {
  let dropped = 0;
  for (const [ids, note] of [
    [closedIds, 'The posting closed before its resume was written.'],
    [returnToSchoolIds, 'This internship is for students returning to school afterwards, so it left the queue.'],
  ]) {
    if (!ids.length) continue;
    const gone = await all(
      `UPDATE tailor_jobs SET status = 'closed', updated_at = NOW()
        WHERE status = 'queued' AND scraped_role_id = ANY($1::bigint[]) RETURNING plan_item_id`,
      [ids],
    );
    if (gone.length) await run('UPDATE plan_items SET stage_note = $2 WHERE id = ANY($1::bigint[])', [gone.map(g => g.plan_item_id), note]);
    dropped += gone.length;
  }
  return dropped;
}

/**
 * A role whose stated closing date has passed (in the user's timezone) can't be
 * applied to: waiting and Ready roles go to Closed. Approved roles are left
 * alone (pullInDeadlines applies them before the date).
 */
export async function closePastDeadlines(userId, tz = 'America/Chicago') {
  const gone = await all(
    `UPDATE tailor_jobs j SET status = 'closed', updated_at = NOW()
       FROM plan_items pi LEFT JOIN scraped_roles sr ON sr.id = pi.scraped_role_id
      WHERE pi.id = j.plan_item_id AND j.user_id = $1 AND j.status IN ('queued', 'ready', 'revision_requested')
        AND COALESCE(pi.apply_deadline, sr.apply_deadline) < (NOW() AT TIME ZONE $2)::date
      RETURNING j.plan_item_id, COALESCE(pi.apply_deadline, sr.apply_deadline)::text AS deadline`,
    [userId, tz],
  );
  for (const g of gone) {
    await run('UPDATE plan_items SET stage_note = $2 WHERE id = $1', [g.plan_item_id, `The posting’s closing date (${fmtDay(g.deadline)}) has passed.`]);
  }
  return gone.length;
}

/**
 * Roles the user doesn't apply to (MBA, PhD-only, or outside software, data and
 * AI by title; `offFieldReason`): a waiting role leaves the queue and its list
 * item is marked skipped, so it never comes back; a Ready role goes to Closed,
 * its resume kept. Approved and applied roles are left alone.
 */
export async function skipOffField(userId) {
  const rows = await all(
    `SELECT j.id, j.status, j.plan_item_id, pi.title, EXISTS (SELECT 1 FROM resume_versions v WHERE v.plan_item_id = j.plan_item_id) AS written
       FROM tailor_jobs j JOIN plan_items pi ON pi.id = j.plan_item_id
      WHERE j.user_id = $1 AND j.status IN ('queued', 'ready', 'revision_requested')`,
    [userId],
  );
  const hits = rows.map(r => ({ ...r, why: offFieldReason(r.title) })).filter(r => r.why);
  if (!hits.length) return { removed: 0, closed: 0 };
  const drop = hits.filter(r => r.status === 'queued' && !r.written);
  const close = hits.filter(r => !drop.includes(r));
  if (drop.length) await run('DELETE FROM tailor_jobs WHERE id = ANY($1::bigint[]) AND status = $2', [drop.map(r => r.id), 'queued']);
  if (close.length) await run("UPDATE tailor_jobs SET status = 'closed', updated_at = NOW() WHERE id = ANY($1::bigint[])", [close.map(r => r.id)]);
  await run(
    `UPDATE plan_items p SET decision = CASE WHEN u.dropped THEN 'skipped' ELSE p.decision END, stage_note = u.note
       FROM unnest($1::bigint[], $2::text[], $3::boolean[]) AS u(id, note, dropped) WHERE p.id = u.id`,
    [hits.map(r => r.plan_item_id), hits.map(r => OFF_FIELD_NOTE[r.why]), hits.map(r => drop.includes(r))],
  );
  return { removed: drop.length, closed: close.length };
}

/**
 * Queue the Roles tab: one role per company + title, locations grouped. A role
 * the user skipped, or one already queued, approved or applied (by role, link
 * or company + title) stays out. Earlier list items for the same role are
 * reused; the rest are new items on the latest list, tier 'queue'.
 */
export async function fillQueue(userId) {
  const w = rolesTabWhere(1);
  const roles = await all(
    // Only roles whose posting has been read: a return-to-school internship or a closed posting never goes in unread.
    `SELECT id, role_type, company_name, title, location, apply_url, salary_range, sponsorship, apply_deadline, COALESCE(posted_at, scraped_at) AS posted
       FROM scraped_roles WHERE ${w.sql} AND facts_read_at IS NOT NULL`,
    w.params,
  );
  const taken = await all(
    `SELECT lower(trim(pi.company_name)) || '|' || lower(trim(pi.title)) AS k, pi.apply_url AS url, pi.scraped_role_id::text AS rid
       FROM plan_items pi
      WHERE pi.user_id = $1 AND (pi.decision IN ('approved', 'skipped') OR EXISTS (SELECT 1 FROM tailor_jobs j WHERE j.plan_item_id = pi.id))
     UNION ALL
     SELECT lower(trim(company_name)) || '|' || lower(trim(job_title)), job_url, NULL
       FROM evaluations WHERE user_id = $1 AND apply_status IN ('submitted', 'responded', 'interview', 'offer', 'rejected')`,
    [userId],
  );
  const keys = new Set(taken.map(t => t.k));
  const urls = new Set(taken.map(t => t.url).filter(Boolean));
  const rids = new Set(taken.map(t => t.rid).filter(Boolean));
  const groups = groupRoles(roles).filter(g => !offFieldReason(g.lead.title) &&
    !keys.has(key(g.lead.company_name, g.lead.title)) && !g.ids.some(id => rids.has(id)) && !urls.has(g.lead.apply_url));
  if (!groups.length) return { roles: roles.length, groups: 0, queued: 0, reused: 0 };

  // Earlier list items for these roles (never queued): reuse them.
  const allIds = groups.flatMap(g => g.ids);
  const earlier = await all(
    "SELECT id, scraped_role_id::text AS rid FROM plan_items WHERE user_id = $1 AND scraped_role_id = ANY($2::bigint[]) AND decision IN ('pending', 'expired')",
    [userId, allIds],
  );
  const itemFor = new Map(earlier.map(e => [e.rid, String(e.id)]));
  const reuse = [];
  const fresh = [];
  for (const g of groups) {
    const hit = itemFor.get(String(g.lead.id)) || g.ids.map(id => itemFor.get(id)).find(Boolean);
    if (hit) reuse.push({ item: hit, rid: g.lead.id, deadline: g.deadline });
    else fresh.push(g);
  }

  const { getSettings, latestPlan } = await import('./dailyPlan.js');
  const plan = await latestPlan(userId, await getSettings(userId));
  const queuedIds = [];
  for (let i = 0; i < fresh.length; i += 300) {
    const c = fresh.slice(i, i + 300);
    const made = await all(
      `INSERT INTO plan_items (plan_id, user_id, scraped_role_id, company_name, title, apply_url, location, pay, sponsorship, tier, reason, decision, stage, apply_deadline)
       SELECT $1, $2, u.rid, u.company, u.title, u.url, u.location, u.pay, u.sponsorship, 'queue', 'From the Roles tab', 'pending', 'proposed', u.deadline::date
         FROM unnest($3::bigint[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[])
              AS u(rid, company, title, url, location, pay, sponsorship, deadline)
       ON CONFLICT (user_id, scraped_role_id) DO NOTHING
       RETURNING id, scraped_role_id`,
      [plan.id, userId, c.map(g => g.lead.id), c.map(g => g.lead.company_name), c.map(g => g.lead.title), c.map(g => g.lead.apply_url),
        c.map(g => g.location), c.map(g => g.lead.salary_range ? String(g.lead.salary_range).slice(0, 100) : null), c.map(g => g.lead.sponsorship), c.map(g => g.deadline)],
    );
    queuedIds.push(...made.map(m => [m.id, m.scraped_role_id]));
  }
  if (reuse.length) {
    await run(
      `UPDATE plan_items p SET apply_deadline = COALESCE(u.deadline::date, p.apply_deadline)
         FROM unnest($1::bigint[], $2::text[]) AS u(id, deadline) WHERE p.id = u.id`,
      [reuse.map(r => r.item), reuse.map(r => r.deadline)],
    );
  }
  const items = [...queuedIds, ...reuse.map(r => [r.item, r.rid])];
  let queued = 0;
  for (let i = 0; i < items.length; i += 500) {
    const c = items.slice(i, i + 500);
    const r = await run(
      `INSERT INTO tailor_jobs (user_id, plan_item_id, scraped_role_id)
       SELECT $1, u.item, u.rid FROM unnest($2::bigint[], $3::bigint[]) AS u(item, rid)
       ON CONFLICT (plan_item_id) DO NOTHING`,
      [userId, c.map(x => x[0]), c.map(x => x[1])],
    );
    queued += r.rowCount;
  }
  return { roles: roles.length, groups: groups.length, queued, reused: reuse.length };
}

/** How many new roles a run has already taken today (the user's day). */
async function claimedToday(userId, tz) {
  return Number((await one(
    "SELECT COUNT(*)::int AS n FROM tailor_jobs WHERE user_id = $1 AND claimed_at >= (date_trunc('day', NOW() AT TIME ZONE $2) AT TIME ZONE $2)",
    [userId, tz],
  ))?.n || 0);
}

/**
 * Put the queue in order (tailor_jobs.priority) and make sure the next
 * `queueCap` roles in line are open: one older than 14 days not confirmed in
 * the last 3 days is checked, and closed ones leave the queue.
 */
export async function prioritizeQueue(userId, { now = new Date(), isOpen = postingOpen, checkLive = true } = {}) {
  const { getSettings } = await import('./dailyPlan.js');
  const settings = await getSettings(userId);
  const rows = await all(
    `SELECT j.id, j.plan_item_id, j.scraped_role_id, j.live_checked_at, pi.apply_url, ${HAS_POSTING_SQL} AS has_text, pi.company_name, sr.tier,
            COALESCE(pi.apply_deadline, sr.apply_deadline) AS deadline, COALESCE(sr.posted_at, sr.scraped_at, pi.created_at) AS posted
       FROM tailor_jobs j JOIN plan_items pi ON pi.id = j.plan_item_id LEFT JOIN scraped_roles sr ON sr.id = j.scraped_role_id
      WHERE j.user_id = $1 AND j.status = 'queued' AND j.claimed_at IS NULL`,
    [userId],
  );
  // Top companies (FAANG+ and quant firms, as on the Jobs page) go right after the closing dates.
  const { companyTiers, tierFor } = await import('./companyTier.js');
  const tiers = await companyTiers();
  for (const r of rows) r.top = r.tier === 'faang' || r.tier === 'quant' || Boolean(tierFor(r.company_name, tiers));
  let order = queueOrder(rows, { now });
  const closed = [];
  const checked = [];
  if (checkLive) {
    let ready = 0;
    for (const r of order) {
      if (ready >= settings.queueCap) break;
      if (!r.has_text) continue; // a run can't take it until its posting is read
      const old = time(r.posted) < now.getTime() - OLD_DAYS * DAY;
      const fresh = time(r.live_checked_at) > now.getTime() - RECHECK_DAYS * DAY;
      if (old && !fresh && r.apply_url) {
        const open = await isOpen(r.apply_url);
        if (open === false) { closed.push(r); continue; }
        checked.push(r.id);
      }
      ready += 1;
    }
  }
  if (closed.length) {
    const ids = closed.map(r => r.id);
    await run("UPDATE tailor_jobs SET status = 'closed', updated_at = NOW() WHERE id = ANY($1::bigint[])", [ids]);
    await run("UPDATE plan_items SET stage_note = 'The posting closed before its resume was written.' WHERE id = ANY($1::bigint[])", [closed.map(r => r.plan_item_id)]);
    const rids = closed.map(r => r.scraped_role_id).filter(Boolean);
    if (rids.length) await run('UPDATE scraped_roles SET is_active = 0 WHERE id = ANY($1::bigint[])', [rids]);
    order = order.filter(r => !closed.includes(r));
  }
  if (checked.length) await run('UPDATE tailor_jobs SET live_checked_at = NOW() WHERE id = ANY($1::bigint[])', [checked]);
  for (let i = 0; i < order.length; i += 1000) {
    const c = order.slice(i, i + 1000);
    await run(
      'UPDATE tailor_jobs j SET priority = u.p FROM unnest($1::bigint[], $2::int[]) AS u(id, p) WHERE j.id = u.id AND j.priority IS DISTINCT FROM u.p',
      [c.map(r => r.id), c.map((_, k) => order.length - (i + k))],
    );
  }
  const today = day(now);
  const until = day(new Date(now.getTime() + SOON_DAYS * DAY));
  const soon = rows.filter(r => { const d = day(r.deadline); return d && d >= today && d <= until; }).length;
  const taken = await claimedToday(userId, settings.timezone);
  return { queued: order.length, closed: closed.length, checked: checked.length, deadlineSoon: soon, cap: settings.queueCap, claimedToday: taken, leftToday: Math.max(settings.queueCap - taken, 0) };
}

const fmtDay = (d, tz) => new Date(`${day(d)}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

/**
 * An approved role whose posting closes before its referral wait ends applies
 * at the company's next morning slot instead (or now, when that's too late).
 * A held role (no outreach) doesn't apply on its own: its note says when the
 * posting closes, so the user can press Apply without referral.
 */
export async function pullInDeadlines(userId, { now = new Date() } = {}) {
  const { nextSendSlot } = await import('./sendWindow.js');
  const rows = await all(
    `SELECT pi.id, pi.apply_after, pi.company_tz, pi.stage_note, COALESCE(pi.apply_deadline, sr.apply_deadline) AS deadline
       FROM plan_items pi LEFT JOIN scraped_roles sr ON sr.id = pi.scraped_role_id
      WHERE pi.user_id = $1 AND pi.decision = 'approved' AND pi.stage = 'waiting_referral'
        AND COALESCE(pi.apply_deadline, sr.apply_deadline) >= CURRENT_DATE`,
    [userId],
  );
  let moved = 0;
  let flagged = 0;
  for (const r of rows) {
    const closesAt = new Date(`${day(r.deadline)}T00:00:00Z`).getTime(); // the deadline's morning, to be safe
    if (r.apply_after) {
      if (time(r.apply_after) < closesAt - DAY / 2) continue; // already goes in time
      let at = nextSendSlot(r.company_tz, { now, startHour: 6, endHour: 10 });
      if (at.getTime() >= closesAt) at = new Date(now.getTime() + 60_000);
      if (at.getTime() >= time(r.apply_after)) continue;
      const note = `The posting closes ${fmtDay(r.deadline)}, before the referral wait ends, so it applies ${at.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: r.company_tz || 'America/Chicago' })} instead.`;
      await run('UPDATE plan_items SET apply_after = $2, wait_until = $2, stage_note = $3 WHERE id = $1 AND user_id = $4', [r.id, at, note, userId]);
      moved += 1;
    } else if (closesAt - now.getTime() < 3 * DAY && !/^The posting closes/.test(r.stage_note || '')) {
      await run('UPDATE plan_items SET stage_note = $2 WHERE id = $1 AND user_id = $3',
        [r.id, `The posting closes ${fmtDay(r.deadline)}. Press Apply without referral to apply before then. ${r.stage_note || ''}`.trim(), userId]);
      flagged += 1;
    }
  }
  return { moved, flagged };
}

/** The cron's step: read new postings, then fill, order and check each pipeline user's queue. */
export async function queueTick({ readLimit = 300, log = console } = {}) {
  // A backlog this big is the one-off backfill's job (it runs on its own); the tick keeps up with new roles.
  const w = rolesTabWhere(1, { keepReturnToSchool: true });
  const unread = Number((await one(`SELECT COUNT(*)::int AS n FROM scraped_roles WHERE ${w.sql} AND facts_read_at IS NULL`, w.params))?.n || 0);
  const read = unread <= 500 ? await readRolesTabPostings({ limit: readLimit, log }) : { read: 0, skipped: `backfill: ${unread} unread` };
  // Postings that couldn't be read get another try, each once a day.
  const retried = await readRolesTabPostings({ limit: 60, log, retry: true });
  const dropped = await dropFromQueue({
    closedIds: [...(read.closedIds || []), ...retried.closedIds],
    returnToSchoolIds: [...(read.returnToSchoolIds || []), ...retried.returnToSchoolIds],
  });
  const users = await all('SELECT DISTINCT user_id FROM tailoring_config');
  const out = [];
  for (const { user_id: userId } of users) {
    const { getSettings } = await import('./dailyPlan.js');
    const pastDeadline = await closePastDeadlines(userId, (await getSettings(userId)).timezone || 'America/Chicago');
    const filled = await fillQueue(userId);
    const offField = await skipOffField(userId);
    const order = await prioritizeQueue(userId);
    const deadlines = await pullInDeadlines(userId);
    out.push({ userId, pastDeadline, filled, offField, order, deadlines });
  }
  const brief = ({ closedIds, returnToSchoolIds, ...rest }) => rest;
  return { read: read.closedIds ? brief(read) : read, retried: brief(retried), dropped, users: out };
}
