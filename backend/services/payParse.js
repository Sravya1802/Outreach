// Pay ranges: one display format for every source, and a text extractor for
// job descriptions (US pay-transparency laws make most postings include one).
//   "$22–28/hr", "$120k–150k/yr", "₹6L–8L/yr", "€55k/yr"

const SYMBOL = { USD: '$', CAD: 'CA$', EUR: '€', GBP: '£', INR: '₹', AUD: 'A$', SGD: 'S$', JPY: '¥', CHF: 'CHF ' };
const UNIT = { hour: 'hr', hourly: 'hr', hr: 'hr', year: 'yr', yearly: 'yr', annual: 'yr', annually: 'yr', yr: 'yr', month: 'mo', monthly: 'mo', week: 'wk', weekly: 'wk', day: 'day', daily: 'day' };

const positive = v => {
  const n = v == null || v === '' ? NaN : Number(v);
  return Number.isFinite(n) && n > 0 ? n : NaN;
};

function amount(n, currency) {
  if (currency === 'INR' && n >= 100_000) return `${+(n / 100_000).toFixed(1)}L`; // lakhs
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
}

/** {min, max, interval, currency} → "$22–28/hr". Null when nothing usable. */
export function formatPay({ min, max, interval, currency = 'USD' } = {}) {
  let lo = positive(min);
  let hi = positive(max);
  if (!Number.isFinite(lo) && !Number.isFinite(hi)) return null;
  if (Number.isFinite(lo) && Number.isFinite(hi) && lo > hi) [lo, hi] = [hi, lo];
  const cur = String(currency || 'USD').toUpperCase();
  const sym = SYMBOL[cur] ?? `${cur} `;
  const unit = UNIT[String(interval || '').toLowerCase()] || '';
  const range = Number.isFinite(lo) && Number.isFinite(hi) && amount(lo, cur) !== amount(hi, cur)
    ? `${amount(lo, cur)}–${amount(hi, cur)}`
    : amount(Number.isFinite(lo) ? lo : hi, cur);
  return `${sym}${range}${unit ? `/${unit}` : ''}`;
}

/** Guess hourly vs yearly from the number when the text doesn't say. */
function inferInterval(n) {
  if (n < 300) return 'hour';
  if (n < 20_000) return 'month';
  return 'year';
}

function num(s, k) {
  const n = Number(String(s).replace(/,/g, ''));
  return k ? n * 1000 : n;
}

const MONEY = String.raw`\$\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?([kK])?(?!\s*(?:million|billion|mm|bn|[mMbB]\b))`;
const PAY_WORDS = /(pay|salary|compensation|wage|rate|stipend|base|range|ote)\b/i;
const RANGE_RE = new RegExp(`${MONEY}\\s*(?:-|–|—|to)\\s*${MONEY}(?:\\s*(?:USD|usd))?\\s*(?:(?:per|an|a|\\/)\\s*(hour|hr|year|yr|annum|annual(?:ly)?|month|week))?`, 'i');
const SINGLE_RE = new RegExp(`${MONEY}(?:\\s*(?:USD|usd))?\\s*(?:(?:per|an|a|\\/)\\s*(hour|hr|year|yr|annum|annual(?:ly)?|month|week))`, 'i');

/** First US-dollar pay range stated in a job description, or null. */
export function payFromText(text) {
  const t = String(text || '').replace(/&nbsp;| /g, ' ').replace(/<[^>]+>/g, ' ');
  const r = RANGE_RE.exec(t);
  if (r) {
    const lo = num(r[1], r[2]);
    const hi = num(r[3], r[4] || r[2]);
    if (!(lo > 0 && hi > 0)) return null;
    const unit = (r[5] || '').toLowerCase().replace(/^annum$|^annual(ly)?$/, 'year').replace(/^hr$/, 'hour').replace(/^yr$/, 'year');
    // Without "per hour/year", only trust a range that a pay word introduces.
    if (!unit && !PAY_WORDS.test(t.slice(Math.max(0, r.index - 120), r.index))) return null;
    const interval = unit || inferInterval(Math.max(lo, hi));
    // Ignore implausible matches (bonus amounts, funding rounds, "$1 to $5 billion").
    if (interval === 'hour' && (hi > 400 || lo < 7)) return null;
    if (interval === 'year' && (hi > 1_500_000 || lo < 15_000)) return null;
    return formatPay({ min: lo, max: hi, interval, currency: 'USD' });
  }
  const s = SINGLE_RE.exec(t);
  if (s) {
    const n = num(s[1], s[2]);
    const unit = s[3].toLowerCase().replace(/^annum$|^annual(ly)?$/, 'year').replace(/^hr$/, 'hour').replace(/^yr$/, 'year');
    if (unit === 'hour' && (n > 400 || n < 7)) return null;
    if (unit === 'year' && (n > 1_500_000 || n < 15_000)) return null;
    return formatPay({ min: n, interval: unit, currency: 'USD' });
  }
  return null;
}
