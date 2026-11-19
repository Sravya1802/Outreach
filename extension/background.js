// Scout'n'Jobs filler: background.
// • Open (from the app): opens a role's application in a new tab.
// • Every morning, the first time Chrome starts (or by 7 AM if it stayed open):
//   opens every ready role in one window, each filled.
// • A ready role's page you open yourself is recognised and filled too.
// filler.js fills each page and frame; this passes what was filled, the
// questions left and "submitted" back to Scout'n'Jobs. It never presses Submit
// and never touches a CAPTCHA.

const APP_ORIGINS = ['https://scoutnjobs.vercel.app', 'http://localhost:5173'];
const API_ORIGINS = ['https://outreach-jt.duckdns.org', 'http://localhost:3001', 'http://localhost:5173'];
const DAY_MS = 24 * 3600_000;
const MORNING_HOUR = 7;
const MAX_DAILY_TABS = 15;

// ── Tabs this extension is filling ──────────────────────────────────────────
async function getPending() {
  const { pending = {} } = await chrome.storage.session.get('pending');
  for (const [tabId, e] of Object.entries(pending)) if (Date.now() - e.at > DAY_MS) delete pending[tabId];
  return pending;
}
const setPending = (pending) => chrome.storage.session.set({ pending });

async function entryFor(tabId) {
  return (await getPending())[tabId] || null;
}
async function updateEntry(tabId, fn) {
  const p = await getPending();
  if (!p[tabId]) return null;
  p[tabId] = fn(p[tabId]) || p[tabId];
  await setPending(p);
  return p[tabId];
}
async function addEntry(tabId, entry) {
  const p = await getPending();
  p[tabId] = entry;
  await setPending(p);
}

async function callApi(entry, path = '', body) {
  const r = await fetch(`${entry.api}/api/fill/${encodeURIComponent(entry.token)}${path}`, body === undefined
    ? {}
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out.error || `Scout'n'Jobs answered ${r.status}`);
  return out;
}

// ── Pairing: the app hands over a key, so mornings and pages opened by hand work ──
async function pairing() {
  const { pair = null } = await chrome.storage.local.get('pair');
  return pair;
}
async function keyApi(path, body) {
  const pair = await pairing();
  if (!pair?.key) return null;
  const r = await fetch(`${pair.api}/api/fill${path}`, body === undefined
    ? { headers: { 'X-SnJ-Key': pair.key } }
    : { method: 'POST', headers: { 'X-SnJ-Key': pair.key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out.error || `Scout'n'Jobs answered ${r.status}`);
  return out;
}

function checkUrl(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error('Only https job pages are filled.');
  if (/(^|\.)linkedin\.com$/i.test(u.hostname)) throw new Error('LinkedIn is applied to by hand.');
}

/** A tab for one role: registered before it navigates, so its first page is filled. */
async function openRole({ token, url, api }, { windowId, active = true } = {}) {
  checkUrl(url);
  const entry = { token, api, at: Date.now(), frames: {}, submitted: false };
  entry.data = await callApi(entry); // a bad or expired link fails here, before a tab opens
  const tab = await chrome.tabs.create({ url: 'about:blank', active, ...(windowId ? { windowId } : {}) });
  await addEntry(tab.id, entry);
  await chrome.tabs.update(tab.id, { url });
  return tab.id;
}

async function open({ token, url, api }) {
  if (!API_ORIGINS.includes(api)) throw new Error('Unknown Scout\'n\'Jobs server.');
  await openRole({ token, url, api });
  return { ok: true };
}

const today = () => new Date().toLocaleDateString('en-CA');

/**
 * The morning: every ready role, each in its own tab of one new window,
 * filled. Once a day. `force` (the app's "Open all now") skips the once-a-day check.
 */
let opening = false;
async function dailyOpen({ force = false, alarm = false } = {}) {
  if (opening) return { ok: false, error: 'Already opening.' };
  const pair = await pairing();
  if (!pair?.key) return { ok: false, error: 'Not paired yet: open Scout\'n\'Jobs once in this browser.' };
  if (!force) {
    if (pair.daily === false) return { ok: false, skipped: 'off' };
    const { lastDaily } = await chrome.storage.local.get('lastDaily');
    if (lastDaily === today()) return { ok: false, skipped: 'done today' };
    if (alarm && new Date().getHours() < MORNING_HOUR) return { ok: false, skipped: 'too early' };
  }
  opening = true;
  try {
    await chrome.storage.local.set({ lastDaily: today() });
    const { roles = [] } = await keyApi('/daily');
    const list = roles.slice(0, MAX_DAILY_TABS);
    if (!list.length) return { ok: true, opened: 0 };
    const win = await chrome.windows.create({ url: 'about:blank', focused: true });
    let opened = 0;
    const errors = [];
    for (const r of list) {
      try {
        await openRole({ token: r.token, url: r.url, api: pair.api }, { windowId: win.id, active: opened === 0 });
        opened += 1;
      } catch (err) {
        errors.push(`${r.company}: ${err.message}`);
      }
    }
    // The window's blank first tab goes once the roles are open.
    const blank = (await chrome.tabs.query({ windowId: win.id })).find(t => t.url === 'about:blank' && !t.pendingUrl);
    if (blank && opened) chrome.tabs.remove(blank.id).catch(() => {});
    await chrome.storage.local.set({ lastDailyResult: { at: Date.now(), opened, errors } });
    return { ok: true, opened, errors };
  } finally {
    opening = false;
  }
}

chrome.runtime.onStartup.addListener(() => { dailyOpen().catch(() => {}); });
chrome.runtime.onInstalled.addListener(() => { chrome.alarms.create('snj-daily', { periodInMinutes: 30 }); });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'snj-daily') dailyOpen({ alarm: true }).catch(() => {}); });
chrome.alarms.get('snj-daily').then((a) => { if (!a) chrome.alarms.create('snj-daily', { periodInMinutes: 30 }); }).catch(() => {});
// The extension waking up counts too (Chrome can start without firing onStartup): still once a day, from 7 AM.
dailyOpen({ alarm: true }).catch(() => {});

// ── A job page opened by hand: is it one of the ready roles? ─────────────────
const misses = new Map(); // url → time, so a page that isn't a ready role isn't asked about again for 10 minutes
const matching = new Map(); // tabId → promise
async function matchTab(tabId, urls) {
  if (matching.has(tabId)) return matching.get(tabId);
  const work = (async () => {
    const key = urls.join(' ');
    if (Date.now() - (misses.get(key) || 0) < 10 * 60_000) return null;
    const pair = await pairing();
    if (!pair?.key) return null;
    const { role } = (await keyApi('/match', { urls }).catch(() => ({ role: null }))) || {};
    if (!role) { misses.set(key, Date.now()); return null; }
    const entry = { token: role.token, api: pair.api, at: Date.now(), frames: {}, submitted: false };
    entry.data = await callApi(entry);
    await addEntry(tabId, entry);
    return entry;
  })();
  matching.set(tabId, work);
  try { return await work; } finally { matching.delete(tabId); }
}

/** Totals across the tab's frames, for the banner and for Scout'n'Jobs. */
function totals(entry) {
  const fr = Object.values(entry.frames || {});
  return {
    filled: fr.reduce((n, f) => n + (f.filled || 0), 0),
    unanswered: [...new Set(fr.flatMap(f => f.unanswered || []))],
    resumeAttached: fr.some(f => f.resumeAttached),
    submitted: Boolean(entry.submitted),
    company: entry.data?.role?.company, title: entry.data?.role?.title,
  };
}

/** The banner lives in the top page; when only a frame has the filler (a form embedded on a company site), that frame shows it. */
async function toPanel(tabId, entry, fromFrame) {
  const state = totals(entry);
  const shown = await chrome.tabs.sendMessage(tabId, { type: 'snj-panel', state }, { frameId: 0 }).catch(() => null);
  if (!shown && fromFrame) chrome.tabs.sendMessage(tabId, { type: 'snj-panel', state, here: true }, { frameId: fromFrame }).catch(() => {});
}

// Every page and frame that finishes loading in a tab being filled gets the filler (company sites that embed the form too).
chrome.webNavigation.onCompleted.addListener(async ({ tabId, frameId }) => {
  if (!(await entryFor(tabId))) return;
  chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files: ['filler.js'] }).catch(() => {});
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const p = await getPending();
  if (p[tabId]) { delete p[tabId]; await setPending(p); }
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const tabId = sender.tab?.id;
  const fromApp = () => {
    const from = sender.url ? new URL(sender.url).origin : '';
    if (!APP_ORIGINS.includes(from)) throw new Error('Only Scout\'n\'Jobs can ask for that.');
  };
  const handle = async () => {
    if (msg.type === 'snj-open') { fromApp(); return open(msg); }
    if (msg.type === 'snj-pair') {
      fromApp();
      if (!API_ORIGINS.includes(msg.api) || !msg.key) throw new Error('Bad pairing.');
      const old = await pairing();
      const pair = { key: msg.key, api: msg.api, daily: msg.daily ?? old?.daily ?? true, at: Date.now() };
      await chrome.storage.local.set({ pair });
      const { lastDaily = null, lastDailyResult = null } = await chrome.storage.local.get(['lastDaily', 'lastDailyResult']);
      return { ok: true, daily: pair.daily, lastDaily, lastDailyResult, version: chrome.runtime.getManifest().version };
    }
    if (msg.type === 'snj-daily-now') { fromApp(); return dailyOpen({ force: true }); }

    let entry = tabId != null ? await entryFor(tabId) : null;
    if (!entry && msg.type === 'snj-fill-data' && tabId != null) {
      entry = await matchTab(tabId, [...new Set([sender.url, sender.tab?.url].filter(Boolean))]);
    }
    if (!entry) return null; // not a ready role's page: the filler does nothing
    if (msg.type === 'snj-fill-data') {
      return { profile: entry.data.profile, role: entry.data.role, resume: entry.data.resume, answers: entry.data.answers || {}, submitted: entry.submitted };
    }
    if (msg.type === 'snj-answers') return callApi(entry, '/answers', { questions: msg.questions });
    if (msg.type === 'snj-report') {
      const e = await updateEntry(tabId, (x) => { x.frames[sender.frameId] = { filled: msg.filled, unanswered: msg.unanswered, resumeAttached: msg.resumeAttached }; });
      const t = totals(e);
      callApi(e, '/report', { filled: t.filled, unanswered: t.unanswered, resumeAttached: t.resumeAttached }).catch(() => {});
      toPanel(tabId, e, sender.frameId);
      return { ok: true };
    }
    if (msg.type === 'snj-panel-state') return totals(entry);
    if (msg.type === 'snj-submitted') {
      if (entry.submitted) return { ok: true };
      // The page's own confirmation counts only after this tab was filled.
      if (msg.auto && totals(entry).filled === 0) return { ok: false };
      await callApi(entry, '/submitted', {});
      const e = await updateEntry(tabId, (x) => { x.submitted = true; });
      toPanel(tabId, e, sender.frameId);
      return { ok: true };
    }
    if (msg.type === 'snj-refill') {
      await updateEntry(tabId, (x) => { x.frames = {}; });
      await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: () => window.__snjFiller?.run(true) }).catch(() => {});
      return { ok: true };
    }
    return null;
  };
  handle().then(reply, (err) => reply({ error: err.message }));
  return true;
});
