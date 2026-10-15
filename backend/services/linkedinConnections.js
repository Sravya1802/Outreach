/**
 * linkedinConnections.js — the user's LinkedIn connections export
 * (LinkedIn → Settings → Data privacy → Get a copy of your data →
 * Connections → Connections.csv). Used to flag roles at companies where they
 * know someone, and to ask those people for referrals first.
 */

import { all, one, run, tx } from '../db.js';

const SUFFIXES = /\b(inc|incorporated|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|plc|gmbh|ag|sa|pvt|private|technologies|technology|labs|group|holdings|the)\b/g;
// Region words LinkedIn often adds ("Garmin International", "Siemens USA").
const REGION = /\b(international|intl|global|worldwide|usa|us|america|americas|north america|india|uk|europe|emea|apac)\b/g;

/** "Ramp Business Corporation, Inc." and "Ramp" → "ramp business" / "ramp". Used on both sides. */
export function companyKey(name) {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\./g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(SUFFIXES, ' ')
    .replace(REGION, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Minimal RFC-4180 CSV: quotes, escaped quotes, commas and newlines inside quotes. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const s = String(text ?? '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Rows of the export (LinkedIn puts a few "Notes:" lines before the header). */
export function parseConnections(csvText) {
  const rows = parseCsv(csvText);
  const h = rows.findIndex(r => r.some(c => /^first name$/i.test(c.trim())) && r.some(c => /^company$/i.test(c.trim())));
  if (h < 0) throw Object.assign(new Error('That doesn’t look like LinkedIn’s Connections.csv (no “First Name” and “Company” columns).'), { status: 400 });
  const head = rows[h].map(c => c.trim().toLowerCase());
  const col = (name) => head.indexOf(name);
  const idx = { first: col('first name'), last: col('last name'), url: col('url'), email: col('email address'), company: col('company'), position: col('position'), on: col('connected on') };
  const out = [];
  for (const r of rows.slice(h + 1)) {
    const get = (k) => (idx[k] >= 0 ? String(r[idx[k]] ?? '').trim() : '');
    const first = get('first');
    const last = get('last');
    const full = `${first} ${last}`.trim();
    if (!full) continue;
    const on = get('on');
    const parsedOn = on && !Number.isNaN(Date.parse(on)) ? new Date(Date.parse(on)).toISOString().slice(0, 10) : null;
    out.push({ first, last, full, url: get('url') || null, email: get('email') || null, company: get('company') || null, position: get('position') || null, connectedOn: parsedOn });
  }
  return out;
}

export async function importConnections(userId, csvText) {
  const people = parseConnections(csvText);
  if (!people.length) throw Object.assign(new Error('No connections found in that file.'), { status: 400 });
  await tx(async (db) => {
    await db.query('DELETE FROM linkedin_connections WHERE user_id = $1', [userId]);
    for (let i = 0; i < people.length; i += 500) {
      const chunk = people.slice(i, i + 500);
      const values = [];
      const params = [];
      chunk.forEach((p, j) => {
        const b = j * 10;
        values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10})`);
        params.push(userId, p.full, p.first, p.last, p.url, p.email, p.company, p.company ? companyKey(p.company) : null, p.position, p.connectedOn);
      });
      await db.query(
        `INSERT INTO linkedin_connections (user_id, full_name, first_name, last_name, profile_url, email, company, company_key, position, connected_on)
         VALUES ${values.join(',')} ON CONFLICT (user_id, full_name, company) DO NOTHING`,
        params,
      );
    }
  });
  return connectionsSummary(userId);
}

export async function connectionsSummary(userId) {
  const total = Number((await one('SELECT COUNT(*)::int AS n FROM linkedin_connections WHERE user_id = $1', [userId]))?.n || 0);
  const top = await all(
    `SELECT max(company) AS company, COUNT(*)::int AS n FROM linkedin_connections
      WHERE user_id = $1 AND company_key <> '' GROUP BY company_key ORDER BY n DESC LIMIT 12`,
    [userId],
  );
  const imported = (await one('SELECT MAX(imported_at) AS t FROM linkedin_connections WHERE user_id = $1', [userId]))?.t || null;
  return { total, imported, topCompanies: top };
}

export async function clearConnections(userId) {
  await run('DELETE FROM linkedin_connections WHERE user_id = $1', [userId]);
}

/** People the user knows at a company, most relevant first (engineers, recruiters, managers). */
export async function connectionsAt(userId, companyName) {
  const key = companyKey(companyName);
  if (!key) return [];
  const rows = await all('SELECT * FROM linkedin_connections WHERE user_id = $1 AND company_key = $2', [userId, key]);
  const rank = (p) => {
    const t = String(p.position || '').toLowerCase();
    if (/recruit|talent|university|campus|people partner|hr\b/.test(t)) return 0;
    if (/engineer|developer|scientist|swe|sde|software|data|ml\b/.test(t)) return 1;
    if (/manager|lead|director|head/.test(t)) return 2;
    return 3;
  };
  return rows.sort((a, b) => rank(a) - rank(b));
}
