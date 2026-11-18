// Scout'n'Jobs filler: runs in each page and frame of a tab Scout'n'Jobs
// opened. Fills empty fields from the profile and saved answers, attaches the
// tailored resume, and lists what it couldn't answer. It never touches a
// CAPTCHA and never presses Submit. Injected again on every page load; on a
// page that changes in place (multi-step forms, Workday) it fills new fields
// as they appear.
(() => {
  if (window.__snjFiller) { window.__snjFiller.run(); return; }
  // CAPTCHA frames and LinkedIn are never touched.
  if (/(^|\.)(google\.com|gstatic\.com|recaptcha\.net|hcaptcha\.com|challenges\.cloudflare\.com|linkedin\.com)$/i.test(location.hostname)) return;

  const TOP = window === window.top;
  const send = (msg) => new Promise((ok) => chrome.runtime.sendMessage(msg, (r) => ok(chrome.runtime.lastError ? null : r)));
  const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const norm = (s) => clean(s).toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9+#/' ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

  let data = null;
  let filled = 0;
  let resumeAttached = false;
  let reportedKey = '';
  let running = false;
  let again = false;
  const answerCache = new Map();
  // Tries per field: a site may clear what was filled (Greenhouse does after reading the resume), so up to 3, never forever.
  let tries = new WeakMap();
  const tryOnce = (el) => { const n = tries.get(el) || 0; if (n >= 3) return false; tries.set(el, n + 1); return true; };

  // ── Reading the form ──────────────────────────────────────────────────────
  const isCaptcha = (el) => /captcha|recaptcha|turnstile/i.test(`${el.name} ${el.id} ${el.className}`) || Boolean(el.closest('[class*="captcha" i], [id*="captcha" i]'));
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const textOf = (el) => clean(el?.innerText || el?.textContent);

  function labelOf(el) {
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const t = clean(by.split(/\s+/).map((id) => textOf(document.getElementById(id))).join(' '));
      if (t) return t;
    }
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l && textOf(l)) return textOf(l);
    }
    const wrap = el.closest('label');
    if (wrap && textOf(wrap)) return textOf(wrap);
    const aria = clean(el.getAttribute('aria-label'));
    if (aria) return aria;
    let node = el.parentElement;
    for (let i = 0; i < 5 && node; i += 1, node = node.parentElement) {
      const l = node.querySelector('label, legend, [class*="label" i], [class*="question" i]');
      if (l && !l.contains(el) && textOf(l)) return textOf(l);
    }
    return clean(el.getAttribute('placeholder')) || '';
  }
  const question = (el) => labelOf(el).replace(/\s*[*✱]+\s*$/, '').replace(/\s*\((required|optional)\)\s*$/i, '').slice(0, 300);
  const required = (el, label) => el.required || el.getAttribute('aria-required') === 'true' || /[*✱]\s*$/.test(labelOf(el)) || /\(required\)/i.test(label);

  // ── Setting values the way a person would (React and friends notice) ──────
  function setValue(el, v) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    el.focus();
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
  }

  // A real click, as a mouse makes it: menus built on React (Greenhouse's) ignore a bare click().
  function press(t) {
    for (const [C, type] of [[PointerEvent, 'pointerdown'], [MouseEvent, 'mousedown'], [PointerEvent, 'pointerup'], [MouseEvent, 'mouseup'], [MouseEvent, 'click']]) {
      t.dispatchEvent(new C(type, { bubbles: true, cancelable: true, composed: true, button: 0, buttons: 1, view: window, pointerType: 'mouse', isPrimary: true }));
    }
  }

  const STOP = new Set(['of', 'at', 'the', 'and', 'in', 'a', 'an', 'for']);
  const plain = (s) => norm(s).replace(/'/g, '');
  const words = (s) => plain(s).split(' ').filter((w) => w && !STOP.has(w));

  /** A number answer ("3.3/4.0") against a range option ("3.1 - 3.6", "3.0 or under", "4+"): true/false, or null when not a range. */
  function inRange(optionText, answer) {
    const m = String(answer).match(/^\s*(\d+(?:\.\d+)?)/);
    if (!m) return null;
    const v = parseFloat(m[1]);
    const r = optionText.match(/(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)/i);
    if (r) return v >= parseFloat(r[1]) && v <= parseFloat(r[2]);
    const u = optionText.match(/(\d+(?:\.\d+)?)\s*(?:or|and)\s*(?:under|below|less|lower)/i);
    if (u) return v <= parseFloat(u[1]);
    const o = optionText.match(/(\d+(?:\.\d+)?)\s*(?:(?:or|and)\s*(?:above|over|higher|more)|\+)/i);
    if (o) return v >= parseFloat(o[1]);
    return null;
  }

  /** How well an option fits the answer: 3 the same, 2.5 in range, 2 starts with it, 1.6–2 most words shared, 0 no. */
  function fits(optionText, answer) {
    if (answer instanceof RegExp) return answer.test(clean(optionText)) ? 3 : 0;
    const o = plain(optionText);
    const a = plain(answer);
    if (!o || !a) return 0;
    if (o === a) return 3;
    const range = inRange(optionText, answer);
    if (range != null) return range ? 2.5 : 0;
    if (o.startsWith(`${a} `) || a.startsWith(`${o} `)) return 2;
    const to = words(optionText);
    const ta = words(answer);
    const shared = ta.filter((w) => to.includes(w)).length;
    const j = shared / new Set([...to, ...ta]).size;
    return j >= 0.6 ? 1 + j : 0;
  }
  const best = (items, textFn, answer) => {
    let top = null;
    let score = 0;
    for (const it of items) {
      const sc = fits(textFn(it), answer);
      if (sc > score) { top = it; score = sc; }
    }
    return top;
  };

  function fillSelect(el, answer) {
    if (el.selectedIndex > 0 && clean(el.value)) return false;
    const opt = best([...el.options].filter((o) => clean(o.value) || clean(o.text)), (o) => o.text, answer);
    if (!opt) return false;
    setValue(el, opt.value);
    return true;
  }

  function fillRadios(inputs, answer) {
    if (inputs.some((r) => r.checked)) return false;
    const r = best(inputs, (x) => labelOf(x) || x.value, answer);
    if (!r) return false;
    press(r);
    return true;
  }

  /** The value a React-style select shows (its input stays empty): the nearest "single-value" box above it. */
  function comboValue(el) {
    let node = el.parentElement;
    for (let i = 0; i < 4 && node; i += 1, node = node.parentElement) {
      const v = node.querySelector('[class*="single-value" i], [class*="singleValue" i], [class*="multi-value" i]');
      if (v && clean(v.textContent)) return v;
    }
    return null;
  }
  /** The open menu's options for this box: its own listbox, else the visible options nearest to it. */
  function menuOptions(el) {
    const own = document.getElementById(el.getAttribute('aria-controls') || '') || document.getElementById(el.getAttribute('aria-owns') || '');
    const all = [...(own || document).querySelectorAll('[role="option"]')].filter(shown);
    let node = el.parentElement;
    for (let i = 0; i < 5 && node; i += 1, node = node.parentElement) {
      const near = all.filter((o) => node.contains(o));
      if (near.length) return near;
    }
    return all;
  }
  async function waitOptions(el, ms) {
    let opts = [];
    for (let t = 0; t < ms; t += 200) {
      await sleep(200);
      opts = menuOptions(el);
      if (opts.length && !/loading|searching/i.test(textOf(opts[0]))) return opts;
    }
    return opts;
  }

  async function fillCombobox(el, answer) {
    if (clean(el.value) || comboValue(el)) return false;
    press(el);
    let opt = best(await waitOptions(el, 800), textOf, answer);
    if (!opt && !(answer instanceof RegExp)) {
      // A search box: type the start of the answer ("University of Illinois"), as a person would.
      const query = String(answer).split(/\s+/).slice(0, 3).join(' ').replace(/[,;]+$/, '').slice(0, 30);
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      let typed = '';
      for (const ch of query) {
        typed += ch;
        setter.call(el, typed);
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }));
        await sleep(25);
      }
      opt = best(await waitOptions(el, 5000), textOf, answer);
    }
    if (opt) {
      press(opt);
      await sleep(200);
      return Boolean(comboValue(el)) || Boolean(clean(el.value));
    }
    if (clean(el.value)) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '');
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    }
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    el.blur();
    return false;
  }

  // ── What to put where ─────────────────────────────────────────────────────
  const yn = (v) => (v == null ? null : v ? 'Yes' : 'No');

  /** The profile answer for a field, or undefined when the field is a question for the saved answers. */
  function fromProfile(el, label) {
    const P = data.profile;
    const kind = el.type || el.tagName.toLowerCase();
    const hay = `${label} ${el.name || ''} ${el.id || ''} ${el.getAttribute('autocomplete') || ''}`;
    const short = label.length <= 60;
    const combo = el.getAttribute('role') === 'combobox' || el.getAttribute('aria-autocomplete') === 'list';
    const textish = !combo && (['text', 'email', 'tel', 'url', 'search', 'textarea', ''].includes(kind) || el.tagName === 'TEXTAREA');
    // Yes/no from the profile, whatever the length of the question.
    if (/sponsor/i.test(label)) return yn(P.needs_sponsorship) ?? undefined;
    if (/relocat/i.test(label)) return yn(P.willing_to_relocate) ?? undefined;
    if (P.gender && /\bgender\b|\bsex\b/i.test(label) && !textish) return P.gender.toLowerCase() === 'female' ? /^(female|woman)\b/i : P.gender;
    if (P.race && /hispanic|latin[oax]/i.test(label) && !/race/i.test(label) && !textish) return P.race.toLowerCase().includes('hispanic') ? /^yes/i : /^no\b/i;
    if (P.race && /\brace\b|ethnic/i.test(label) && !textish) return P.race.toLowerCase() === 'asian' ? /^asian/i : P.race;
    if (P.veteran && /veteran/i.test(label) && !textish) return /not/.test(P.veteran) ? /not a (protected )?veteran|i am not|^no\b/i : /^yes|i identify as|protected veteran/i;
    if (P.disability && /disabilit/i.test(label) && !textish) return /^no/i.test(P.disability) ? /^no,? i (do not|don.t)|^no\b/i : /^yes/i;
    if (!short) return undefined;
    if (/e-?mail/i.test(hay)) return P.email;
    if (/\b(first|given)[ _-]?name\b|firstname|^first\b/i.test(hay) && !/preferred/i.test(label)) return P.first_name;
    if (/\b(last|family|sur)[ _-]?name\b|lastname|surname/i.test(hay)) return P.last_name;
    if (/preferred/i.test(label)) return undefined;
    if (/^(full |legal |your )?name\b/i.test(label) || el.getAttribute('autocomplete') === 'name' || el.name === 'name') return P.full_name;
    if (/phone|mobile|\bcell\b/i.test(hay) && textish) {
      // A separate country-code picker (+1) next to it: the number without the code.
      const picker = document.querySelector('.iti, [class*="country-code" i], [class*="phone-country" i], input#country');
      return picker ? P.phone.replace(/^\+1[\s-]*/, '') : P.phone;
    }
    if (/linkedin/i.test(hay)) return P.linkedin;
    if (/github/i.test(hay)) return P.github;
    if (/portfolio|website|personal site|web site/i.test(hay) && textish) return P.portfolio;
    if (/address( line)? ?1|street|^address$/i.test(label) && textish) return P.address;
    if (/\bcity\b/i.test(label)) return P.city;
    if (/\bstate\b|province/i.test(label)) return P.state;
    if (/zip|postal/i.test(label)) return P.postal;
    if (/^country\b/i.test(label)) return P.country;
    if (/^(current )?location\b|where are you (currently )?(located|based)/i.test(label)) return P.location;
    if (/school|university|college|institution/i.test(label)) return P.school;
    if (/\bdegree\b/i.test(label)) {
      if (/^master/i.test(P.degree)) return /^master'?s( degree)?$|^master of science|^m\.?s\.?$/i;
      if (/^bachelor/i.test(P.degree)) return /^bachelor'?s( degree)?$|^bachelor of (science|technology|engineering)|^b\.?(s|tech|e)\.?$/i;
      return P.degree;
    }
    if (/major|discipline|field of study|area of study/i.test(label)) return P.major;
    if (/\bgpa\b|grade point/i.test(label)) return P.gpa;
    if (/^end date month/i.test(label)) return P.graduation_month;
    if (/^end date year/i.test(label)) return P.graduation_year;
    if (/graduat/i.test(label)) {
      if (/year/i.test(label)) return P.graduation_year;
      if (/month/i.test(label)) return P.graduation_month;
      return el.tagName === 'SELECT' ? P.graduation_year : P.graduation;
    }
    return undefined;
  }

  // ── The resume ────────────────────────────────────────────────────────────
  function attachResume() {
    const inputs = [...document.querySelectorAll('input[type="file"]')].filter((i) => !i.disabled);
    if (!inputs.length || !data.resume?.base64) return false;
    const about = (i) => `${labelOf(i)} ${i.name} ${i.id} ${i.getAttribute('accept') || ''} ${i.closest('[class]')?.className || ''}`;
    const resumeLike = inputs.filter((i) => /resume|r[ée]sum[ée]|\bcv\b/i.test(about(i)) && !/cover/i.test(about(i)));
    const plain = resumeLike.filter((i) => !/autofill|parse/i.test(about(i)));
    const target = plain[0] || resumeLike[0] || (inputs.length === 1 && !/cover|transcript/i.test(about(inputs[0])) ? inputs[0] : null);
    if (!target) return false;
    if (target.files?.length) return true;
    const bytes = Uint8Array.from(atob(data.resume.base64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], data.resume.filename || 'resume.pdf', { type: 'application/pdf' }));
    target.files = dt.files;
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  // ── Submitted? ────────────────────────────────────────────────────────────
  const CONFIRM = /thank you for (applying|submitting your application)|thanks for applying|(your )?application (was|has been) (successfully )?(received|submitted)|we('|’)ve received your application|application submitted/i;
  function looksSubmitted() {
    const formy = [...document.querySelectorAll('input[type="text"], input[type="email"], input[type="file"], textarea')].filter(shown).length;
    return formy < 2 && CONFIRM.test(textOf(document.body).slice(0, 5000));
  }

  // ── One pass over the page ────────────────────────────────────────────────
  async function pass() {
    if (!data || data.submitted) return;
    if (looksSubmitted()) { await send({ type: 'snj-submitted', auto: true }); return; }
    // The resume first: some sites read it and fill (or clear) fields, which must happen before ours.
    if (!resumeAttached) {
      resumeAttached = attachResume();
      if (resumeAttached) await sleep(4000);
    }

    const fields = [...document.querySelectorAll('input, textarea, select')]
      .filter((el) => !el.disabled && !el.readOnly && !isCaptcha(el) && el.type !== 'hidden' && el.type !== 'file'
        && !['submit', 'button', 'reset', 'image', 'password'].includes(el.type) && shown(el));
    const groups = new Map(); // radio and checkbox groups by name
    const singles = [];
    for (const el of fields) {
      if ((el.type === 'radio' || el.type === 'checkbox') && el.name) {
        if (!groups.has(el.name)) groups.set(el.name, []);
        groups.get(el.name).push(el);
      } else if (el.type !== 'checkbox' && el.type !== 'radio') singles.push(el);
    }
    const groupLabel = (inputs) => {
      const fs = inputs[0].closest('fieldset');
      const legend = fs?.querySelector('legend');
      if (legend && textOf(legend)) return textOf(legend).replace(/\s*\*+\s*$/, '');
      const group = inputs[0].closest('[role="radiogroup"], [role="group"]');
      if (group?.getAttribute('aria-labelledby')) return labelOf(group);
      let node = inputs[0].parentElement;
      for (let i = 0; i < 6 && node; i += 1, node = node.parentElement) {
        if (inputs.every((x) => node.contains(x))) {
          const l = node.querySelector('label, legend, [class*="label" i], [class*="question" i]');
          if (l && !inputs.some((x) => l.contains(x)) && textOf(l)) return textOf(l).replace(/\s*\*+\s*$/, '');
        }
      }
      return '';
    };

    // Work items: [label, apply(answer) → filled?, isEmpty(), required]
    const work = [];
    for (const el of singles) {
      const label = question(el);
      if (!label) continue;
      const combo = el.getAttribute('role') === 'combobox' || el.getAttribute('aria-autocomplete') === 'list';
      work.push({
        label, el, required: required(el, label),
        empty: () => (el.tagName === 'SELECT' ? !(el.selectedIndex > 0 && clean(el.value)) : !clean(el.value)) && !(combo && comboValue(el)),
        apply: async (a) => (el.tagName === 'SELECT' ? fillSelect(el, a) : combo ? fillCombobox(el, a) : (a instanceof RegExp ? false : (setValue(el, String(a)), true))),
      });
    }
    for (const inputs of groups.values()) {
      const label = groupLabel(inputs);
      if (!label) continue;
      const isRadio = inputs[0].type === 'radio';
      if (!isRadio && inputs.length === 1) continue; // a lone checkbox is consent or a preference: the user decides
      work.push({
        label, el: inputs[0], required: inputs.some((x) => x.required) || /\*/.test(labelOf(inputs[0].closest('fieldset') || inputs[0])),
        empty: () => !inputs.some((x) => x.checked),
        apply: async (a) => fillRadios(inputs, a),
      });
    }

    const questions = [];
    for (const w of work) {
      if (!w.empty()) continue;
      const v = fromProfile(w.el, w.label);
      if (v instanceof RegExp || (v != null && v !== '')) {
        if (!tryOnce(w.el)) continue;
        if (await w.apply(v) && tries.get(w.el) === 1) filled += 1;
      } else if (v === undefined && !answerCache.has(w.label)) questions.push(w.label);
    }
    if (questions.length) {
      const r = await send({ type: 'snj-answers', questions: [...new Set(questions)] });
      for (const q of questions) answerCache.set(q, r?.answers?.[q] ?? null);
    }
    for (const w of work) {
      if (!w.empty()) continue;
      const a = answerCache.get(w.label);
      if (!a || !tryOnce(w.el)) continue;
      if (await w.apply(a) && tries.get(w.el) === 1) filled += 1;
    }

    const unanswered = [...new Set(work.filter((w) => w.required && w.empty()).map((w) => w.label))];
    for (const w of work) w.el.style.outline = w.required && w.empty() ? '2px solid #e5484d' : '';
    const key = JSON.stringify([filled, unanswered, resumeAttached]);
    if (key !== reportedKey && (filled || unanswered.length || resumeAttached)) {
      reportedKey = key;
      await send({ type: 'snj-report', filled, unanswered, resumeAttached });
    }
  }

  async function run(fresh = false) {
    if (fresh) { filled = 0; resumeAttached = false; reportedKey = ''; answerCache.clear(); tries = new WeakMap(); }
    if (running) { again = true; return; }
    running = true;
    try {
      if (!data) data = await send({ type: 'snj-fill-data' });
      if (!data) return;
      do { again = false; await pass(); } while (again);
    } catch (err) {
      console.warn('[Scout\'n\'Jobs filler]', err);
    } finally {
      running = false;
    }
  }

  // New fields on pages that change in place (next step, a question that appears): fill them too, for 20 minutes.
  let timer = null;
  const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(() => run(), 700); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 20 * 60_000);

  // ── The panel (top page only) ─────────────────────────────────────────────
  if (TOP) {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;display:none';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        .box{font:14px/1.45 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#0f1d2b;background:#fff;border:1px solid #c9dcef;border-radius:10px;box-shadow:0 8px 28px rgba(11,107,203,.18);width:320px;max-height:60vh;overflow:auto;padding:14px 16px}
        h1{font-size:14px;margin:0 0 6px;color:#0b6bcb}
        p{margin:6px 0} ul{margin:4px 0 8px;padding-left:18px} li{margin:2px 0}
        .row{display:flex;gap:8px;margin-top:10px}
        button{font:inherit;border-radius:7px;padding:6px 10px;cursor:pointer;border:1px solid #c9dcef;background:#f3f8fd;color:#0f1d2b}
        button.main{background:#0b6bcb;border-color:#0b6bcb;color:#fff}
        .x{position:absolute;top:6px;right:10px;border:0;background:none;font-size:18px;color:#5b6b7b;padding:0}
        .warn{color:#b42318}
      </style>
      <div class="box"><button class="x" title="Hide">×</button><div class="body"></div></div>`;
    const body = root.querySelector('.body');
    root.querySelector('.x').onclick = () => { host.style.display = 'none'; };
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const draw = (st) => {
      if (!st) return;
      host.style.display = 'block';
      if (st.submitted) {
        body.innerHTML = `<h1>Scout'n'Jobs</h1><p>Marked applied: ${esc(st.company || '')}. You can close this tab.</p>`;
        return;
      }
      body.innerHTML = `
        <h1>Scout'n'Jobs · ${esc(st.company || '')}</h1>
        <p>Filled ${st.filled} field${st.filled === 1 ? '' : 's'}${st.resumeAttached ? ' and attached your tailored resume' : ''}.</p>
        ${st.resumeAttached ? '' : '<p class="warn">Resume not attached yet: attach it from the role page if this form has an upload.</p>'}
        ${st.unanswered.length ? `<p class="warn">Needs you (outlined in red):</p><ul>${st.unanswered.map((q) => `<li>${esc(q)}</li>`).join('')}</ul>` : ''}
        <p>Check the answers, do the CAPTCHA, then press Submit yourself.</p>
        <div class="row"><button class="main done">I submitted it</button><button class="again">Fill again</button></div>`;
      body.querySelector('.done').onclick = async () => { const r = await send({ type: 'snj-submitted' }); if (r?.error) alert(r.error); };
      body.querySelector('.again').onclick = () => send({ type: 'snj-refill' });
    };
    chrome.runtime.onMessage.addListener((m) => { if (m?.type === 'snj-panel') draw(m.state); });
    (document.body || document.documentElement).appendChild(host);
    send({ type: 'snj-panel-state' }).then((st) => { if (st && (st.filled || st.submitted || st.unanswered?.length)) draw(st); });
  }

  window.__snjFiller = { run };
  run();
})();
