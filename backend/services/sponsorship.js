// Does a job description say whether it sponsors visas? Deterministic phrase
// matching, no AI: the answer has to be checkable, so we keep the sentence
// that decided it. Strictest signal wins:
//   citizens_only   — US citizens (or US persons) only, or a security clearance
//   no_sponsorship  — "won't sponsor", "without sponsorship", …
//   sponsors        — "visa sponsorship available", "we sponsor H-1B", CPT/OPT welcome
//   null            — the description doesn't say

const US = String.raw`(?:U\.?\s?S\.?|United States|American)`;

const CITIZENS_ONLY = [
  new RegExp(String.raw`\bmust be (?:a |an )?${US} citizens?\b`, 'i'),
  new RegExp(String.raw`\b${US} citizenship (?:is )?(?:required|mandatory)\b`, 'i'),
  new RegExp(String.raw`\b(?:requires?|requiring) ${US} citizenship\b`, 'i'),
  new RegExp(String.raw`\b(?:open|available) (?:only )?to ${US} citizens(?: only)?\b`, 'i'),
  new RegExp(String.raw`\b${US} citizens only\b`, 'i'),
  new RegExp(String.raw`\b${US} persons? only\b`, 'i'),
  /\b(?:active|current|ability to obtain|able to obtain|eligib(?:le|ility) (?:for|to obtain)|must (?:hold|have|obtain|maintain))\b[^.]{0,30}\b(?:secret|top secret|TS\/SCI|DoD|government|federal|security) (?:security )?clearance\b/i,
  /\bTS\/SCI\b/i,
];

const NO_SPONSORSHIP = [
  /\b(?:not|unable to|cannot|can't|won't|will not|do not|does not|don't|doesn't|are not able to|is not able to)\b[^.]{0,40}\b(?:sponsor|sponsorship)\b/i,
  /\bwithout (?:the need for |requiring |needing )?(?:current or future |now or in the future,? |any )?(?:employer |company )?(?:visa |immigration |work )?sponsorship\b/i,
  /\bno (?:visa |immigration |H-?1B )?sponsorship\b/i,
  /\bsponsorship (?:is )?not (?:available|provided|offered|possible)\b/i,
  /\bnot eligible for (?:visa |immigration )?sponsorship\b/i,
];

const SPONSORS = [
  /\b(?:will|can|do|does|are able to|is able to|happy to|willing to|we)\b[^.]{0,30}\b(?:sponsor (?:visas?|H-?1B|work)|provide (?:visa |immigration )?sponsorship|offer (?:visa |immigration )?sponsorship|support (?:visa|immigration))\b/i,
  /\b(?:visa|immigration|H-?1B) sponsorship (?:is )?(?:available|provided|offered|supported)\b/i,
  /\bsponsorship (?:is )?available\b/i,
  /\b(?:CPT|OPT|STEM OPT)\b[^.]{0,40}\b(?:eligible|welcome|accepted|supported|encouraged)\b/i,
  /\b(?:eligible|welcome)\b[^.]{0,30}\b(?:CPT|OPT)\b/i,
];

// Sentence boundary: a period, ! or ? followed by space or end, except after a
// single capital letter ("U.S.", "D.C.") so abbreviations don't cut a sentence.
const BOUNDARY = /(?<!\b[A-Z])[.!?](?=\s|$)|\n/g;

function sentenceAround(text, index) {
  let start = 0;
  let end = text.length;
  BOUNDARY.lastIndex = 0;
  for (let m; (m = BOUNDARY.exec(text));) {
    if (m.index < index) start = m.index + 1;
    else { end = m[0] === '\n' ? m.index : m.index + 1; break; }
  }
  return text.slice(start, end).trim().slice(0, 300);
}

/** Plain text from description HTML (handles Greenhouse's escaped HTML). */
export function plainText(html) {
  return String(html || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&#8217;/g, "'").replace(/&nbsp;| /g, ' ')
    .replace(/<\/(p|li|div|h\d|br)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** { status, quote } — status is citizens_only | no_sponsorship | sponsors | null. */
export function classifySponsorship(text) {
  const t = plainText(text);
  if (!t) return { status: null, quote: null };
  for (const [status, patterns] of [['citizens_only', CITIZENS_ONLY], ['no_sponsorship', NO_SPONSORSHIP], ['sponsors', SPONSORS]]) {
    for (const re of patterns) {
      const m = re.exec(t);
      if (m) return { status, quote: sentenceAround(t, m.index) };
    }
  }
  return { status: null, quote: null };
}
