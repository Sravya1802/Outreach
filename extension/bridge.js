// Runs on the Scout'n'Jobs site only. Tells the page the extension is here,
// and passes the page's requests to the background: Open (a signed one-role
// link), pair (the key for mornings and pages opened by hand) and Open all now.
document.documentElement.dataset.snjFiller = chrome.runtime.getManifest().version;

const TYPES = { open: 'snj-open', pair: 'snj-pair', 'daily-now': 'snj-daily-now' };

window.addEventListener('message', (e) => {
  if (e.source !== window || e.origin !== location.origin) return;
  const m = e.data;
  if (!m || m.source !== 'snj-app' || !TYPES[m.type]) return;
  const { source, type, id, ...rest } = m;
  chrome.runtime.sendMessage({ ...rest, type: TYPES[type] }, (r) => {
    const error = chrome.runtime.lastError?.message || r?.error || null;
    window.postMessage({ source: 'snj-ext', type: type === 'open' ? 'opened' : `${type}-done`, id, ok: !error, error, result: r || null }, location.origin);
  });
});
