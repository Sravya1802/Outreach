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
  if (a && b) return `${a} -- ${b}`;
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

const bullets = (items) => {
  const xs = nonEmpty(items);
  return xs.length ? `\\begin{rbullets}\n${xs.map(b => `  \\item ${escapeTex(b)}`).join('\n')}\n\\end{rbullets}\n` : '';
};

function education(list) {
  const xs = nonEmpty(list);
  if (!xs.length) return '';
  return `\\rsection{Education}\n${xs.map(e => {
    const degree = [e.degree, e.field].filter(Boolean).join(', ');
    const gpa = e.gpa ? `GPA: ${e.gpa}` : '';
    const lines = [`\\entry{${escapeTex(e.school)}}{${escapeTex(e.location)}}{${escapeTex(degree)}}{${escapeTex(dateRange(e.start, e.end))}}`];
    const details = [gpa, ...nonEmpty(e.details)].filter(Boolean);
    if (details.length) lines.push(`{\\small ${details.map(escapeTex).join(' \\textbar{} ')}}\\par`);
    return lines.join('\n');
  }).join('\n\\vspace{3pt}\n')}\n`;
}

function experience(list) {
  const xs = nonEmpty(list);
  if (!xs.length) return '';
  return `\\rsection{Experience}\n${xs.map(e =>
    `\\entry{${escapeTex(e.title)}}{${escapeTex(dateRange(e.start, e.end))}}{${escapeTex(e.company)}}{${escapeTex(e.location)}}\n${bullets(e.bullets)}`,
  ).join('\\vspace{2pt}\n')}`;
}

function projects(list) {
  const xs = nonEmpty(list);
  if (!xs.length) return '';
  return `\\rsection{Projects}\n${xs.map(p => {
    const tech = nonEmpty(p.tech).join(', ');
    const href = safeUrl(p.link);
    const right = href ? `\\href{${href}}{${escapeTex(displayUrl(p.link))}}` : escapeTex(dateRange(p.start, p.end));
    return `\\textbf{${escapeTex(p.name)}}${tech ? ` \\textbar{} \\textit{${escapeTex(tech)}}` : ''}\\hfill ${right}\\par\n${bullets(p.bullets)}`;
  }).join('\\vspace{2pt}\n')}`;
}

function skills(list) {
  const xs = nonEmpty(list).filter(s => nonEmpty(s.items).length);
  if (!xs.length) return '';
  return `\\rsection{Skills}\n${xs.map(s => `\\textbf{${escapeTex(s.category)}:} ${nonEmpty(s.items).map(escapeTex).join(', ')}`).join('\\\\\n')}\\par\n`;
}

function extras(list) {
  return nonEmpty(list).filter(x => nonEmpty(x.items).length).map(x =>
    `\\rsection{${escapeTex(x.heading)}}\n${bullets(x.items)}`).join('');
}

/** A resume document (the engine's shape) → a complete .tex file. */
export function resumeTex(doc) {
  const summary = String(doc.summary || '').trim();
  return `${PREAMBLE}\\begin{document}
${header(doc)}${summary ? `\\rsection{Summary}\n${escapeTex(summary)}\\par\n` : ''}${education(doc.education)}${experience(doc.experience)}${projects(doc.projects)}${skills(doc.skills)}${extras(doc.extras)}\\end{document}
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
