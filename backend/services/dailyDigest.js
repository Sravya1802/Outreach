// ── Job-alert digest emails (#9) ─────────────────────────────────────────────
// Counts roles added to the shared catalog within a window and emails a summary.
// Supports per-subscriber filters (role type + keywords + daily/weekly window)
// so users can subscribe LinkedIn-style. Safe to call without email configured.
import { all } from '../db.js';
import { sendMail, mailerConfigured, notifyRecipient } from './mailer.js';

// Build the WHERE clause + params for a filtered, windowed roles query.
function buildFilter({ windowDays = 1, roleType = 'all', keywords = '' } = {}) {
  const clauses = ['is_active = 1', `scraped_at > NOW() - ($1::int * INTERVAL '1 day')`];
  const params = [Math.max(1, Number(windowDays) || 1)];
  if (roleType === 'intern' || roleType === 'new_grad') {
    params.push(roleType);
    clauses.push(`role_type = $${params.length}`);
  }
  const kw = String(keywords || '').split(/[,\n]/).map(s => s.trim()).filter(Boolean).slice(0, 10);
  if (kw.length) {
    const ors = kw.map(k => { params.push(`%${k}%`); return `title ILIKE $${params.length}`; });
    clauses.push(`(${ors.join(' OR ')})`);
  }
  return { where: clauses.join(' AND '), params };
}

export async function buildDigestData(opts = {}) {
  const { where, params } = buildFilter(opts);
  const [counts, companyRow, bySource, sample] = await Promise.all([
    all(`SELECT role_type, COUNT(*)::int AS n FROM scraped_roles WHERE ${where} GROUP BY role_type`, params),
    all(`SELECT COUNT(DISTINCT company_name)::int AS n FROM scraped_roles WHERE ${where}`, params),
    all(`SELECT source, COUNT(*)::int AS n FROM scraped_roles WHERE ${where} GROUP BY source ORDER BY n DESC`, params),
    all(`SELECT title, company_name, location, apply_url, role_type FROM scraped_roles WHERE ${where} ORDER BY scraped_at DESC LIMIT 25`, params),
  ]);
  const intern  = counts.find(c => c.role_type === 'intern')?.n || 0;
  const newGrad = counts.find(c => c.role_type === 'new_grad')?.n || 0;
  return { total: intern + newGrad, intern, newGrad, companies: companyRow[0]?.n || 0, bySource, sample };
}

function esc(s = '') {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function digestHtml(d, { windowDays = 1, unsubscribeNote = true } = {}) {
  const span = windowDays >= 7 ? 'this week' : 'today';
  const rows = d.sample.map(r => `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;font-size:13px;color:#0f172a;font-weight:600">${esc(r.company_name)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;font-size:13px;color:#475569">
        <a href="${esc(r.apply_url)}" style="color:#4f46e5;text-decoration:none">${esc(r.title)}</a>
        <div style="font-size:11px;color:#94a3b8">${esc(r.location || '')} · ${r.role_type === 'new_grad' ? 'New grad' : 'Intern'}</div>
      </td>
    </tr>`).join('');
  const sources = d.bySource.map(s => `${esc(s.source)} (${s.n})`).join(' · ');
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:640px;margin:0 auto;color:#0f172a">
    <h1 style="font-size:22px;margin:0 0 4px">🎯 ${d.total} new role${d.total !== 1 ? 's' : ''} ${span}</h1>
    <p style="color:#64748b;font-size:13px;margin:0 0 18px">
      Across <strong>${d.companies}</strong> companies — <strong>${d.intern}</strong> internships · <strong>${d.newGrad}</strong> new-grad.
    </p>
    <div style="display:flex;gap:10px;margin-bottom:18px">
      <div style="flex:1;background:#eef2ff;border-radius:10px;padding:12px 14px"><div style="font-size:22px;font-weight:800;color:#6366f1">${d.intern}</div><div style="font-size:12px;color:#475569">Intern</div></div>
      <div style="flex:1;background:#ecfdf5;border-radius:10px;padding:12px 14px"><div style="font-size:22px;font-weight:800;color:#059669">${d.newGrad}</div><div style="font-size:12px;color:#475569">New grad</div></div>
      <div style="flex:1;background:#faf5ff;border-radius:10px;padding:12px 14px"><div style="font-size:22px;font-weight:800;color:#7c3aed">${d.companies}</div><div style="font-size:12px;color:#475569">Companies</div></div>
    </div>
    ${d.sample.length ? `<table style="width:100%;border-collapse:collapse;border:1px solid #eee;border-radius:8px;overflow:hidden">${rows}</table>` : '<p style="color:#94a3b8">No matching new roles in this window.</p>'}
    <p style="color:#94a3b8;font-size:11px;margin-top:16px">Sources: ${sources || '—'}. Sent by OutreachOS Job Alerts.${unsubscribeNote ? ' Manage or unsubscribe from the dashboard.' : ''}</p>
  </div>`;
}

// Send a built digest to a specific recipient (per-subscriber).
export async function sendDigestToEmail(email, data, { windowDays = 1 } = {}) {
  const span = windowDays >= 7 ? 'this week' : 'today';
  const subject = `🎯 ${data.total} new roles ${span} — ${data.intern} intern · ${data.newGrad} new grad`;
  const text = `${data.total} new roles ${span} across ${data.companies} companies: ${data.intern} intern, ${data.newGrad} new grad.`;
  return sendMail({ to: email, subject, html: digestHtml(data, { windowDays }), text });
}

// Legacy/global path: send to the env NOTIFY_EMAIL (used by the admin "send now").
export async function sendDailyRolesDigest({ force = false } = {}) {
  const d = await buildDigestData({ windowDays: 1 });
  if (d.total === 0 && !force) return { ...d, email: { skipped: true, reason: 'no_new_roles' } };
  const email = await sendDigestToEmail(notifyRecipient(), d, { windowDays: 1 });
  return { ...d, email };
}

/**
 * Fan out digests to every subscriber. Called by the daily cron:
 *   weekly=false → daily subscribers (24h window)
 *   weekly=true  → weekly subscribers (7d window), run only on the chosen day
 */
export async function runSubscriptionDigests({ weekly = false } = {}) {
  if (!mailerConfigured()) return { skipped: true, reason: 'mailer_not_configured' };
  const rows = await all(`SELECT user_id, value FROM meta WHERE key = 'job_alert_subscription'`);
  let sent = 0, empty = 0, failed = 0, considered = 0;
  for (const row of rows) {
    let sub; try { sub = JSON.parse(row.value); } catch { continue; }
    if (!sub?.subscribed || !sub.email) continue;
    const freq = sub.frequency === 'weekly' ? 'weekly' : 'daily';
    if ((weekly && freq !== 'weekly') || (!weekly && freq !== 'daily')) continue;
    considered++;
    const windowDays = freq === 'weekly' ? 7 : 1;
    try {
      const data = await buildDigestData({ roleType: sub.roleType, keywords: sub.keywords, windowDays });
      if (data.total === 0) { empty++; continue; } // don't send an empty alert
      const r = await sendDigestToEmail(sub.email, data, { windowDays });
      if (r.ok) sent++; else empty++;
    } catch (e) {
      failed++;
      console.warn(`[alerts] digest failed for user ${row.user_id}: ${e.message}`);
    }
  }
  return { considered, sent, empty, failed };
}
