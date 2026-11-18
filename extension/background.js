// Scout'n'Jobs filler: background. Opens a role's application in a new tab,
// fills each page of it (filler.js, every frame), and passes what was filled,
// the questions left and "submitted" back to Scout'n'Jobs. It never presses
// Submit and never touches a CAPTCHA.

const APP_ORIGINS = ['https://scoutnjobs.vercel.app', 'http://localhost:5173'];
const API_ORIGINS = ['https://outreach-jt.duckdns.org', 'http://localhost:3001', 'http://localhost:5173'];
const DAY_MS = 24 * 3600_000;

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

async function callApi(entry, path = '', body) {
  const r = await fetch(`${entry.api}/api/fill/${encodeURIComponent(entry.token)}${path}`, body === undefined
    ? {}
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out.error || `Scout'n'Jobs answered ${r.status}`);
  return out;
}

async function open({ token, url, api }) {
  if (!API_ORIGINS.includes(api)) throw new Error('Unknown Scout\'n\'Jobs server.');
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error('Only https job pages are filled.');
  if (/(^|\.)linkedin\.com$/i.test(u.hostname)) throw new Error('LinkedIn is applied to by hand.');
  const entry = { token, api, at: Date.now(), frames: {}, submitted: false };
  entry.data = await callApi(entry); // a bad or expired link fails here, before a tab opens
  const tab = await chrome.tabs.create({ url });
  const p = await getPending();
  p[tab.id] = entry;
  await setPending(p);
  return { ok: true };
}

/** Totals across the tab's frames, for the panel and for Scout'n'Jobs. */
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

const toPanel = (tabId, entry) => chrome.tabs.sendMessage(tabId, { type: 'snj-panel', state: totals(entry) }, { frameId: 0 }).catch(() => {});

// Every page (and frame) that finishes loading in a tab we opened gets the filler.
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
  const handle = async () => {
    if (msg.type === 'snj-open') {
      const from = sender.url ? new URL(sender.url).origin : '';
      if (!APP_ORIGINS.includes(from)) throw new Error('Open only works from Scout\'n\'Jobs.');
      return open(msg);
    }
    const entry = tabId != null ? await entryFor(tabId) : null;
    if (!entry) return null; // not a tab Scout'n'Jobs opened: the filler does nothing
    if (msg.type === 'snj-fill-data') {
      return { profile: entry.data.profile, role: entry.data.role, resume: entry.data.resume, submitted: entry.submitted, filledBefore: totals(entry).filled > 0 };
    }
    if (msg.type === 'snj-answers') return callApi(entry, '/answers', { questions: msg.questions });
    if (msg.type === 'snj-report') {
      const e = await updateEntry(tabId, (x) => { x.frames[sender.frameId] = { filled: msg.filled, unanswered: msg.unanswered, resumeAttached: msg.resumeAttached }; });
      const t = totals(e);
      callApi(e, '/report', { filled: t.filled, unanswered: t.unanswered, resumeAttached: t.resumeAttached }).catch(() => {});
      toPanel(tabId, e);
      return { ok: true };
    }
    if (msg.type === 'snj-panel-state') return totals(entry);
    if (msg.type === 'snj-submitted') {
      if (entry.submitted) return { ok: true };
      // The page's own confirmation counts only after this tab was filled.
      if (msg.auto && totals(entry).filled === 0) return { ok: false };
      await callApi(entry, '/submitted', {});
      const e = await updateEntry(tabId, (x) => { x.submitted = true; });
      toPanel(tabId, e);
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
