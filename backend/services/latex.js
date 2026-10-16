/**
 * latex.js — resume and cover-letter documents → LaTeX → PDF (pdflatex).
 *
 * The template is single-column with standard headings, real text (no
 * tables, images or icons) and \pdfgentounicode so ATS parsers read the PDF
 * as plain text. Every value from a resume or the AI goes through escapeTex:
 * nothing user-written can become a LaTeX command, and pdflatex runs without
 * shell escape.
 */

import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Characters pdflatex (T1 + utf8 inputenc) can't set get a close ASCII form;
// anything else outside Latin-1 is dropped rather than failing the build.
const UNICODE_MAP = {
  '\u2018': '`', '\u2019': "'", '\u201A': ',', '\u201C': '\u0001', '\u201D': '"', '\u201E': '"',
  '\u2013': '--', '\u2014': '---', '\u2212': '-', '\u2010': '-', '\u2011': '-',
  '\u2022': '-', '\u25CF': '-', '\u25AA': '-', '\u2023': '-', '\u2043': '-', '\u00B7': '|',
  '\u2026': '...', '\u00A0': ' ', '\u2009': ' ', '\u202F': ' ', '\u200B': '',
  '\u2192': '->', '\u2190': '<-', '\u2264': '<=', '\u2265': '>=', '\u00D7': 'x', '\u2248': '~',
  '\u2122': '(TM)', '\u00AE': '(R)', '\u00A9': '(C)', '\u2713': '', '\u2714': '',
};

export function toLatin(s) {
  return String(s ?? '')
    .normalize('NFC')
    .replace(/[\u2018-\u201E\u2013\u2014\u2212\u2010\u2011\u2022\u25CF\u25AA\u2023\u2043\u00B7\u2026\u00A0\u2009\u202F\u200B\u2192\u2190\u2264\u2265\u00D7\u2248\u2122\u00AE\u00A9\u2713\u2714]/g, c => UNICODE_MAP[c] ?? '')
    .replace(/[^\x01\x09\x0A\x0D\x20-\x7E\u00A1-\u00FF]/g, '');
}

/** Plain text → safe LaTeX. Dashes and quotes from toLatin keep their meaning. */
export function escapeTex(s) {
  return toLatin(s)
    .replace(/\\/g, '\u0000')
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/</g, '\\textless{}')
    .replace(/>/g, '\\textgreater{}')
    .replace(/\|/g, '\\textbar{}')
    .replace(/\u0000/g, '\\textbackslash{}')
    .replace(/\u0001/g, '``')
    .replace(/"/g, "''")
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

/** Only http(s)/mailto links, with hyperref's special characters escaped. */
export function safeUrl(u) {
  const s = String(u ?? '').trim();
  if (!s) return '';
  const withScheme = /^(https?:\/\/|mailto:)/i.test(s) ? s : `https://${s}`;
  let parsed;
  try { parsed = new URL(withScheme); } catch { return ''; }
  if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) return '';
  const href = parsed.href;
  if (/[\s\\{}"<>^`|]/.test(href)) return '';
  return href.replace(/([%#&])/g, '\\$1');
}

/** "https://www.linkedin.com/in/sravya/" → "linkedin.com/in/sravya" */
export function displayUrl(u) {
  return String(u ?? '').trim().replace(/^(https?:\/\/)?(www\.)?/i, '').replace(/\/+$/, '');
}

const nonEmpty = (xs) => (Array.isArray(xs) ? xs : []).map(x => (typeof x === 'string' ? x.trim() : x)).filter(Boolean);

export function dateRange(start, end) {
  const a = String(start || '').trim();
  const b = String(end || '').trim();
  if (a && b) return a.toLowerCase() === b.toLowerCase() ? a : `${a} -- ${b}`;
  return a || b;
}

const PREAMBLE = String.raw`\documentclass[letterpaper,10pt]{article}
\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage{lmodern}
\usepackage[margin=0.5in,top=0.45in,bottom=0.45in]{geometry}
\usepackage[hidelinks]{hyperref}
\input{glyphtounicode}
\pdfgentounicode=1
\pagestyle{empty}
\setlength{\parindent}{0pt}
\setlength{\parskip}{0pt}
\linespread{1.04}
\newcommand{\rsection}[1]{\par\vspace{7pt}{\large\bfseries #1}\par\vspace{-2pt}\rule{\linewidth}{0.4pt}\par\vspace{2pt}}
\newenvironment{rbullets}{\begin{list}{\textbullet}{\setlength{\leftmargin}{1.1em}\setlength{\labelwidth}{0.7em}\setlength{\labelsep}{0.4em}\setlength{\itemsep}{0.5pt}\setlength{\topsep}{1.5pt}\setlength{\parsep}{0pt}\setlength{\partopsep}{0pt}}}{\end{list}}
\newcommand{\entry}[4]{\textbf{#1}\hfill #2\\\textit{#3}\hfill\textit{#4}\par}
`;

function header(doc) {
  const c = doc.contact || {};
  const bits = [];
  if (c.email) bits.push(`\\href{${safeUrl(`mailto:${c.email}`)}}{${escapeTex(c.email)}}`);
  if (c.phone) bits.push(escapeTex(c.phone));
  if (c.location) bits.push(escapeTex(c.location));
  for (const l of nonEmpty(c.links)) {
    const href = safeUrl(l.url);
    if (href) bits.push(`\\href{${href}}{${escapeTex(displayUrl(l.url))}}`);
  }
  return `\\begin{center}
{\\LARGE\\bfseries ${escapeTex(doc.name || 'Your Name')}}\\\\[3pt]
${bits.join(' \\textbar{} ')}
\\end{center}
\\vspace{-6pt}
`;
}

/** Like escapeTex but keeps the edges' spaces (for pieces of one sentence). */
function escapePiece(s) {
  const lead = /^\s/.test(s) ? ' ' : '';
  const trail = /\s$/.test(s) && s.trim() ? ' ' : '';
  return `${lead}${escapeTex(s)}${trail}`;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * One bullet with its metrics and the job's tools in bold. Spans are found
 * on the plain text and each piece is escaped on its own, so bolding can't
 * open a way for text to become a command.
 */
export function richText(s, { terms = [], metrics = true, metricSpans = () => [], maxTools = 2 } = {}) {
  const text = String(s ?? '').replace(/\s+/g, ' ').trim();
  const spans = metrics ? metricSpans(text).map(m => ({ start: m.start, end: m.end })) : [];
  let tools = 0;
  for (const t of [...new Set(terms)].sort((a, b) => b.length - a.length)) {
    if (tools >= maxTools) break;
    const re = new RegExp(`(?<![A-Za-z0-9+#])${escapeRe(t)}(?![A-Za-z0-9+#])`, 'i');
    const m = re.exec(text);
    if (!m) continue;
    const span = { start: m.index, end: m.index + m[0].length };
    if (spans.some(x => span.start < x.end && x.start < span.end)) continue;
    spans.push(span);
    tools += 1;
  }
  spans.sort((a, b) => a.start - b.start);
  let out = '';
  let at = 0;
  for (const sp of spans) {
    if (sp.start < at) continue;
    out += escapePiece(text.slice(at, sp.start));
    out += `\\textbf{${escapeTex(text.slice(sp.start, sp.end))}}`;
    at = sp.end;
  }
  return (out + escapePiece(text.slice(at))).replace(/ {2,}/g, ' ').trim();
}

// The resume template: the user's own layout (10pt, 0.4in sides, uppercase
// ruled headings, compact lists). A user can replace the preamble with their
// own .tex; the body below only uses commands every preamble has.
export const RESUME_PREAMBLE = String.raw`\documentclass[10pt, letterpaper]{article}
\usepackage[top=0.25in, bottom=0.1in, left=0.4in, right=0.4in]{geometry}
\usepackage{enumitem}
\usepackage{titlesec}
\usepackage{parskip}
\usepackage[hidelinks]{hyperref}
\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage{tabularx}
\usepackage[expansion=false]{microtype}
\DisableLigatures[f]{encoding = *, family = *}
\input{glyphtounicode}
\pdfgentounicode=1

\setlength{\parskip}{0ex}
\setlist[itemize]{noitemsep, topsep=0pt, partopsep=0pt, parsep=0pt, leftmargin=1.2em}
\titlespacing*{\section}{0pt}{1.0pt}{0.3pt}
\titleformat{\section}{\bfseries\uppercase}{\thesection}{1em}{}[\titlerule]

\pagenumbering{gobble}
`;

// Commands a custom preamble may not use: file and shell access, catcode tricks.
const FORBIDDEN = /\\(write18|immediate|openout|openin|read\b|readline|include\b|includeonly|directlua|latelua|catcode|scantokens|special|newwrite|newread|ShellEscape|pdfprimitive|primitive|outer|everyjob|endlinechar)/;

/**
 * Pull the preamble out of a user's .tex (everything before \begin{document})
 * and check it's safe to compile. { ok, preamble } or { ok: false, error }.
 */
export function checkPreamble(tex) {
  const s = String(tex ?? '').replace(/\r\n?/g, '\n');
  if (s.length > 100_000) return { ok: false, error: 'That file is too large for a resume template.' };
  const i = s.indexOf('\\begin{document}');
  const pre = (i >= 0 ? s.slice(0, i) : s).trim();
  if (!/\\documentclass/.test(pre)) return { ok: false, error: 'No \\documentclass line found. Paste the whole .tex file, from \\documentclass down.' };
  const code = pre.split('\n').map(l => l.replace(/(?<!\\)%.*$/, '')).join('\n');
  const bad = code.match(FORBIDDEN);
  if (bad) return { ok: false, error: `The template uses \\${bad[1]}, which isn’t allowed here.` };
  for (const m of code.matchAll(/\\input\s*\{([^}]*)\}/g)) {
    if (m[1].trim() !== 'glyphtounicode') return { ok: false, error: `The template inputs another file (${m[1]}), which isn’t allowed here.` };
  }
  if (/\\input(?!\s*\{)/.test(code)) return { ok: false, error: 'The template uses \\input without braces, which isn’t allowed here.' };
  let preamble = pre;
  if (!/\{hyperref\}/.test(code)) preamble += '\n\\usepackage[hidelinks]{hyperref}';
  return { ok: true, preamble: `${preamble}\n` };
}

function linkLabel(url) {
  const u = String(url || '');
  const last = displayUrl(u).split('/').filter(Boolean).pop() || '';
  if (/linkedin\.com/i.test(u)) return `LinkedIn/${last}`;
  if (/github\.com/i.test(u)) return `GitHub/${last}`;
  return displayUrl(u);
}

const SEP = ' \\; $|$ \\; ';

function resumeHeader(doc) {
  const c = doc.contact || {};
  const bits = [];
  if (c.location) bits.push(escapeTex(c.location));
  if (c.email) bits.push(`\\href{${safeUrl(`mailto:${c.email}`)}}{${escapeTex(c.email)}}`);
  if (c.phone) bits.push(escapeTex(c.phone));
  for (const l of nonEmpty(c.links)) {
    const href = safeUrl(l.url);
    if (href) bits.push(`\\href{${href}}{${escapeTex(linkLabel(l.url))}}`);
  }
  return `\\begin{center}
    {\\large \\textbf{${escapeTex(doc.name || 'Your Name')}}} \\\\
    \\vspace{1.5pt}
    {\\small ${bits.join(SEP)}}
\\end{center}
`;
}

const heading = (title, before = '3pt', after = '2.5pt') => `\n\\vspace{${before}}\n\\section*{${escapeTex(String(title).toUpperCase())}}\n\\vspace{${after}}\n`;

function itemize(items, fmt) {
  const xs = nonEmpty(items);
  return xs.length ? `\\begin{itemize}\n${xs.map(b => `    \\item ${fmt(b)}`).join('\n')}\n\\end{itemize}\n` : '';
}

function resumeEducation(list) {
  const xs = nonEmpty(list);
  if (!xs.length) return '';
  return heading('Education', '5pt') + '\n' + xs.map(e => {
    const field = String(e.field || '').trim();
    const degree = String(e.degree || '').trim();
    const name = field && !degree.toLowerCase().includes(field.toLowerCase()) ? `${degree}${degree ? ' in ' : ''}${field}` : degree || field;
    const gpa = e.gpa ? ` \\textbar{} GPA ${escapeTex(String(e.gpa).replace(/^gpa:?\s*/i, ''))}` : '';
    const lines = [
      `\\textbf{${escapeTex(e.school)}} \\hfill {${escapeTex(dateRange(e.start, e.end))}} \\\\`,
      `\\textit{${escapeTex(name)}}${gpa} \\hfill ${escapeTex(e.location)}${nonEmpty(e.details).length ? ' \\\\' : ''}`,
      ...nonEmpty(e.details).map((d, i, a) => `${escapeTex(d)}${i < a.length - 1 ? ' \\\\' : ''}`),
    ];
    return lines.join('\n');
  }).join('\n\\vspace{1pt}\n\n') + '\n';
}

/** Experience grouped under the master's own headings, in doc order. */
function resumeExperience(list, fmt) {
  const groups = [];
  for (const e of nonEmpty(list)) {
    const h = String(e.section || 'Experience').trim();
    let g = groups.find(x => x.h.toLowerCase() === h.toLowerCase());
    if (!g) groups.push(g = { h, entries: [] });
    g.entries.push(e);
  }
  return groups.map(g => heading(g.h) + '\n' + g.entries.map(e =>
    `\\textbf{${escapeTex(e.company)}} \\hfill {${escapeTex(e.location)}} \\\\
\\textit{${escapeTex(e.title)}} \\hfill {${escapeTex(dateRange(e.start, e.end))}}
${itemize(e.bullets, fmt)}`).join('\n\\vspace{2pt}\n')).join('');
}

function resumeProjects(list, fmt) {
  const xs = nonEmpty(list);
  if (!xs.length) return '';
  return heading('Projects', '2pt', '2pt') + xs.map(p => {
    const href = safeUrl(p.link);
    const name = `\\textbf{${escapeTex(p.name)}}`;
    return `${href ? `\\href{${href}}{${name}}` : name} \\hfill ${escapeTex(dateRange(p.start, p.end))}
${itemize(p.bullets, fmt)}`;
  }).join('\\vspace{1pt}\n');
}

function resumeSkills(skills, certs) {
  const xs = nonEmpty(skills).filter(s => nonEmpty(s.items).length);
  const cert = nonEmpty(certs?.items);
  if (!xs.length && !cert.length) return '';
  const lines = [];
  if (xs.length) lines.push(xs.map(s => `\\textbf{${escapeTex(s.category)}} -- ${nonEmpty(s.items).map(escapeTex).join(', ')}`).join(' \\textbar{} '));
  if (cert.length) lines.push(`\\textbf{${escapeTex(certs.heading || 'Certifications')}} -- ${cert.map(escapeTex).join(' \\textbar{} ')}`);
  return heading('Technical Skills', '2pt', '1.5pt') + lines.join(' \\\\\n') + '\n';
}

function resumeExtras(list) {
  return nonEmpty(list).filter(x => nonEmpty(x.items).length).map(x => {
    const items = nonEmpty(x.items);
    const pub = /publication/i.test(x.heading);
    const fmtItem = (it) => {
      const m = pub ? /^(.*\S)\s+in\s+(\S.*)$/.exec(it) : null;
      return m ? `\\textit{${escapeTex(m[1])}} in ${escapeTex(m[2])}` : escapeTex(it);
    };
    const body = items.every(it => it.length <= 90)
      ? `${items.map(fmtItem).join(' \\textbar{} ')}\n`
      : itemize(items, escapeTex);
    return heading(x.heading, '2pt', '1.5pt') + body;
  }).join('');
}

/**
 * A resume document (the engine's shape) → a complete .tex file, in the
 * user's template. Order: header, summary, education, experience sections
 * (as ordered in the doc), projects, technical skills with certifications,
 * then the remaining sections.
 *
 * opts.preamble     the user's own preamble (checked by checkPreamble)
 * opts.boldTerms    the job's tools, bolded where a bullet uses them
 * opts.metricSpans  finds metrics to bold (resumeRules.metricSpans)
 * opts.projectMetrics  bold metrics in project bullets (quant roles)
 */
export function resumeTex(doc, { preamble = RESUME_PREAMBLE, boldTerms = [], metricSpans, projectMetrics = true } = {}) {
  const fmt = (b) => richText(b, { terms: boldTerms, metrics: Boolean(metricSpans), metricSpans });
  const fmtProject = (b) => richText(b, { terms: boldTerms, metrics: Boolean(metricSpans) && projectMetrics, metricSpans });
  const summary = String(doc.summary || '').trim();
  const extras = nonEmpty(doc.extras);
  const certs = extras.find(x => /certif/i.test(x.heading || ''));
  return `${preamble}
\\begin{document}

${resumeHeader(doc)}${summary ? `${heading('Summary', '3pt', '1.5pt')}${escapeTex(summary)}\n` : ''}${resumeEducation(doc.education)}${resumeExperience(doc.experience, fmt)}${resumeProjects(doc.projects, fmtProject)}${resumeSkills(doc.skills, certs)}${resumeExtras(extras.filter(x => x !== certs))}
\\end{document}
`;
}

/** A cover letter: sender header, date, greeting, paragraphs, sign-off. */
export function coverLetterTex({ name, contact = {}, date, company, greeting, paragraphs = [], closing = 'Sincerely,' }) {
  const doc = { name, contact };
  return `${PREAMBLE.replace('\\linespread{1.04}', '\\linespread{1.12}')}\\begin{document}
${header(doc)}\\vspace{14pt}
${escapeTex(date)}\\par\\vspace{8pt}
${company ? `${escapeTex(company)}\\par\\vspace{10pt}\n` : ''}${escapeTex(greeting || 'Dear Hiring Manager,')}\\par\\vspace{8pt}
${nonEmpty(paragraphs).map(p => `${escapeTex(p)}\\par\\vspace{8pt}`).join('\n')}
${escapeTex(closing)}\\par\\vspace{4pt}
${escapeTex(name)}\\par
\\end{document}
`;
}

function run(cmd, args, opts) {
  return new Promise((resolve) => {
    execFile(cmd, args, opts, (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
  });
}

export function pdflatexPath() {
  return process.env.PDFLATEX_PATH || 'pdflatex';
}

/** Compile .tex → { pdf: Buffer, pages }. Throws with the LaTeX error line on failure. */
export async function compileTex(tex, { timeoutMs = 60_000 } = {}) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tex-'));
  try {
    await fs.promises.writeFile(path.join(dir, 'main.tex'), tex, 'utf8');
    const { err } = await run(pdflatexPath(), ['-interaction=nonstopmode', '-halt-on-error', '-no-shell-escape', 'main.tex'],
      { cwd: dir, timeout: timeoutMs, env: { ...process.env, openin_any: 'p', openout_any: 'p' } });
    const log = await fs.promises.readFile(path.join(dir, 'main.log'), 'utf8').catch(() => '');
    if (err && err.code === 'ENOENT') throw new Error('pdflatex is not installed on the server');
    const pdfPath = path.join(dir, 'main.pdf');
    if (!fs.existsSync(pdfPath)) {
      const line = log.split('\n').find(l => l.startsWith('!')) || err?.message || 'unknown error';
      throw new Error(`LaTeX failed: ${line.slice(0, 200)}`);
    }
    const m = /Output written on main\.pdf \((\d+) pages?/.exec(log);
    return { pdf: await fs.promises.readFile(pdfPath), pages: m ? Number(m[1]) : null };
  } finally {
    fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
