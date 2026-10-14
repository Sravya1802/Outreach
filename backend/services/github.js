// "Sign in with GitHub" and the repo import that feeds resume tailoring.
// OAuth app with no scopes: the token can read the user's public profile and
// public repos only. Tokens are stored sealed (secretBox.js) and refreshed
// when GitHub issues expiring tokens.
import { all, one, run } from '../db.js';
import { open, seal, signState } from './secretBox.js';

const API = 'https://api.github.com';
const OAUTH = 'https://github.com/login/oauth';
const MAX_REPOS = 100;
const README_CHARS = 3000;

export function githubConfigured(env = process.env) {
  return Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET && env.TOKEN_ENC_KEY);
}

export function callbackUrl(env = process.env) {
  return env.GITHUB_REDIRECT_URI || 'https://outreach-jt.duckdns.org/api/github/callback';
}

export function authorizeUrl(userId, env = process.env) {
  const u = new URL(`${OAUTH}/authorize`);
  u.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  u.searchParams.set('redirect_uri', callbackUrl(env));
  u.searchParams.set('state', signState(userId, { env }));
  u.searchParams.set('allow_signup', 'false');
  // No `scope`: public data only (OAuth apps have no read-only private-repo scope).
  return u.toString();
}

async function tokenRequest(params, fetchImpl = fetch) {
  const res = await fetchImpl(`${OAUTH}/access_token`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: process.env.GITHUB_CLIENT_ID, client_secret: process.env.GITHUB_CLIENT_SECRET, ...params }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error || !body.access_token) {
    throw new Error(body.error_description || body.error || `GitHub token request failed (HTTP ${res.status})`);
  }
  return body;
}

/** GitHub token response → columns to store (expiry times absolute). */
export function tokenColumns(t, now = Date.now()) {
  const at = s => (Number(s) > 0 ? new Date(now + Number(s) * 1000).toISOString() : null);
  return {
    access_token: seal(t.access_token),
    access_expires_at: at(t.expires_in),
    refresh_token: t.refresh_token ? seal(t.refresh_token) : null,
    refresh_expires_at: at(t.refresh_token_expires_in),
    scope: t.scope ?? '',
  };
}

async function gh(path, token, { accept = 'application/vnd.github+json', fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${API}${path}`, {
    headers: { Accept: accept, Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'OutreachOS' },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const err = new Error(`GitHub ${path} failed (HTTP ${res.status})`);
    err.status = res.status;
    throw err;
  }
  return accept.includes('raw') ? res.text() : res.json();
}

/** Finish sign-in: trade the code for a token and store the connection. */
export async function completeSignIn(userId, code) {
  const t = await tokenRequest({ code, redirect_uri: callbackUrl() });
  const me = await gh('/user', t.access_token);
  const cols = tokenColumns(t);
  await run(
    `INSERT INTO github_connections (user_id, github_id, login, avatar_url, access_token, access_expires_at, refresh_token, refresh_expires_at, scope, connected_at, sync_status, sync_error)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), 'idle', NULL)
     ON CONFLICT (user_id) DO UPDATE SET
       github_id = EXCLUDED.github_id, login = EXCLUDED.login, avatar_url = EXCLUDED.avatar_url,
       access_token = EXCLUDED.access_token, access_expires_at = EXCLUDED.access_expires_at,
       refresh_token = EXCLUDED.refresh_token, refresh_expires_at = EXCLUDED.refresh_expires_at,
       scope = EXCLUDED.scope, connected_at = NOW(), sync_status = 'idle', sync_error = NULL`,
    [userId, me.id, me.login, me.avatar_url ?? null, cols.access_token, cols.access_expires_at, cols.refresh_token, cols.refresh_expires_at, cols.scope],
  );
  // A different GitHub account replaces the old one's repos.
  await run('DELETE FROM github_repos WHERE user_id = $1 AND full_name NOT ILIKE $2', [userId, `${me.login}/%`]);
  return me.login;
}

/** A usable access token, refreshing it first if it's about to expire. */
async function accessToken(userId) {
  const c = await one('SELECT * FROM github_connections WHERE user_id = $1', [userId]);
  if (!c) throw Object.assign(new Error('GitHub is not connected'), { status: 409 });
  const expiresAt = c.access_expires_at ? new Date(c.access_expires_at).getTime() : Infinity;
  if (expiresAt - Date.now() > 60_000) return open(c.access_token);
  if (!c.refresh_token) throw Object.assign(new Error('GitHub access expired. Connect GitHub again.'), { status: 409 });
  const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: open(c.refresh_token) });
  const cols = tokenColumns(t);
  await run(
    `UPDATE github_connections SET access_token = $2, access_expires_at = $3, refresh_token = COALESCE($4, refresh_token), refresh_expires_at = COALESCE($5, refresh_expires_at)
      WHERE user_id = $1`,
    [userId, cols.access_token, cols.access_expires_at, cols.refresh_token, cols.refresh_expires_at],
  );
  return t.access_token;
}

/** README markdown → plain text worth showing a model: no badges, images, HTML or link targets. */
export function readmeText(md) {
  return String(md || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/[*_`>|]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
    .slice(0, README_CHARS);
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

/** Re-import the user's public, owned repos (README + languages for non-forks). */
export async function syncRepos(userId) {
  await run(`UPDATE github_connections SET sync_status = 'syncing', sync_error = NULL WHERE user_id = $1`, [userId]);
  try {
    const token = await accessToken(userId);
    const repos = (await gh(`/user/repos?visibility=public&affiliation=owner&sort=pushed&per_page=${MAX_REPOS}`, token)) || [];
    const details = await mapLimit(repos, 4, async r => {
      if (r.fork) return { readme: null, languages: {} };
      const [readme, languages] = await Promise.all([
        gh(`/repos/${r.full_name}/readme`, token, { accept: 'application/vnd.github.raw' }).catch(() => null),
        gh(`/repos/${r.full_name}/languages`, token).catch(() => ({})),
      ]);
      return { readme: readme ? readmeText(readme) : null, languages: languages || {} };
    });
    const seen = [];
    for (const [k, r] of repos.entries()) {
      seen.push(r.id);
      await run(
        `INSERT INTO github_repos (user_id, repo_id, full_name, name, description, html_url, homepage, language, languages, topics, stars, fork, archived, pushed_at, readme, include, synced_at)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::text[], $11, $12, $13, $14, $15, $16, NOW())
         ON CONFLICT (user_id, repo_id) DO UPDATE SET
           full_name = EXCLUDED.full_name, name = EXCLUDED.name, description = EXCLUDED.description, html_url = EXCLUDED.html_url,
           homepage = EXCLUDED.homepage, language = EXCLUDED.language, languages = EXCLUDED.languages, topics = EXCLUDED.topics,
           stars = EXCLUDED.stars, fork = EXCLUDED.fork, archived = EXCLUDED.archived, pushed_at = EXCLUDED.pushed_at,
           readme = EXCLUDED.readme, synced_at = NOW()`,
        [userId, r.id, r.full_name, r.name, r.description ?? null, r.html_url, r.homepage || null, r.language ?? null,
          JSON.stringify(details[k].languages), r.topics ?? [], r.stargazers_count ?? 0, !!r.fork, !!r.archived, r.pushed_at ?? null,
          details[k].readme, !r.fork && !r.archived],
      );
    }
    // Repos deleted or made private since the last sync drop out of the pool.
    await run('DELETE FROM github_repos WHERE user_id = $1 AND NOT (repo_id = ANY($2::bigint[]))', [userId, seen]);
    await run(`UPDATE github_connections SET sync_status = 'idle', last_synced_at = NOW() WHERE user_id = $1`, [userId]);
    return { repos: repos.length };
  } catch (err) {
    await run(`UPDATE github_connections SET sync_status = 'error', sync_error = $2 WHERE user_id = $1`, [userId, String(err.message).slice(0, 300)]);
    throw err;
  }
}

export async function githubStatus(userId) {
  const c = await one(
    'SELECT login, avatar_url, connected_at, last_synced_at, sync_status, sync_error FROM github_connections WHERE user_id = $1',
    [userId],
  );
  return { configured: githubConfigured(), connected: !!c, ...(c || {}) };
}

export async function listRepos(userId) {
  return all(
    `SELECT repo_id, full_name, name, description, html_url, homepage, language, languages, topics, stars, fork, archived, pushed_at,
            include, (readme IS NOT NULL) AS has_readme, left(readme, 280) AS readme_preview
       FROM github_repos WHERE user_id = $1
      ORDER BY include DESC, fork ASC, pushed_at DESC NULLS LAST`,
    [userId],
  );
}

export async function setRepoIncluded(userId, repoId, include) {
  const r = await run('UPDATE github_repos SET include = $3 WHERE user_id = $1 AND repo_id = $2', [userId, repoId, !!include]);
  return r.rowCount > 0;
}

/** Revoke the grant at GitHub (best effort) and forget the connection and repos. */
export async function disconnect(userId) {
  const c = await one('SELECT access_token FROM github_connections WHERE user_id = $1', [userId]);
  if (c) {
    try {
      const basic = Buffer.from(`${process.env.GITHUB_CLIENT_ID}:${process.env.GITHUB_CLIENT_SECRET}`).toString('base64');
      await fetch(`${API}/applications/${process.env.GITHUB_CLIENT_ID}/grant`, {
        method: 'DELETE',
        headers: { Authorization: `Basic ${basic}`, Accept: 'application/vnd.github+json', 'User-Agent': 'OutreachOS', 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: open(c.access_token) }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch { /* still forget it locally */ }
  }
  await run('DELETE FROM github_repos WHERE user_id = $1', [userId]);
  await run('DELETE FROM github_connections WHERE user_id = $1', [userId]);
}
