// Runs on the Scout'n'Jobs site only. Tells the page the extension is here,
// and passes its Open clicks (a signed one-role link) to the background.
document.documentElement.dataset.snjFiller = chrome.runtime.getManifest().version;

window.addEventListener('message', (e) => {
  if (e.source !== window || e.origin !== location.origin) return;
  const m = e.data;
  if (!m || m.source !== 'snj-app' || m.type !== 'open') return;
  chrome.runtime.sendMessage({ type: 'snj-open', token: m.token, url: m.url, api: m.api }, (r) => {
    const error = chrome.runtime.lastError?.message || r?.error || null;
    window.postMessage({ source: 'snj-ext', type: 'opened', id: m.id, ok: !error, error }, location.origin);
  });
});
