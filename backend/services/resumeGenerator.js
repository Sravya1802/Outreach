/**
 * resumeGenerator.js
 * Generates tailored ATS-optimised PDF using santifer/career-ops cv-template.html.
 *
 * Flow (mirrors oferta.md §PDF + pdf.md):
 *  1. AI rewrites resume sections with JD keyword injection (never invents)
 *  2. Fills santifer's {{PLACEHOLDER}} tokens in cv-template.html
 *  3. Puppeteer renders to PDF
 */

import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { claudeText, hasClaudeKey } from './claude.js';
import OpenAI from 'openai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR  = path.join(__dirname, '..', 'output');
const TEMPLATE_PATH = path.join(__dirname, '..', 'career-ops-src', 'templates', 'cv-template.html');
const FONTS_DIR   = path.join(__dirname, '..', 'career-ops-src', 'fonts');

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// ── AI call (Gemini → Claude fallback) ───────────────────────────────────────

async function callAI(prompt) {
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'optional_fallback') {
    try {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
      const result = await Promise.race([
        model.generateContent(prompt),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Gemini timeout')), 25000)),
      ]);
      return result.response.text();
    } catch (_) {}
  }
  if (hasClaudeKey()) {
    return claudeText({ user: prompt, effort: 'medium' });
  }
  if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'optional_fallback') {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const msg = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });
    return msg.choices[0].message.content;
  }
  throw new Error('No AI provider configured');
}

// ── Tailor resume via AI → structured JSON for template ──────────────────────

export async function tailorResume(resumeText, jobDescription, jobTitle, companyName) {
  const prompt = `You are running the santifer/career-ops pdf mode — ATS-optimised resume tailoring.

## Rules (from pdf.md)
- NEVER invent experience or skills. Only reformulate existing experience with JD vocabulary.
- Keyword injection strategy: if JD says "RAG pipelines" and CV says "LLM workflows with retrieval" → use "RAG pipeline design and LLM orchestration workflows"
- Inject top 5 JD keywords into Professional Summary
- Reorder bullets so most relevant experience appears first for this JD
- Single-column, ATS-clean output

## Input
CANDIDATE RESUME:
${resumeText.slice(0, 4000)}

JOB DESCRIPTION:
${jobDescription.slice(0, 2500)}

TARGET: ${jobTitle} at ${companyName}

## Output
Return ONLY valid JSON (no markdown fences):
{
  "candidateName": "full name from resume",
  "email": "email from resume",
  "phone": "phone or empty string",
  "linkedin": "linkedin URL or empty string",
  "linkedinDisplay": "linkedin.com/in/handle or empty string",
  "portfolio": "portfolio URL or empty string",
  "portfolioDisplay": "display text for portfolio or empty string",
  "location": "city, state/country from resume",
  "summary": "3-4 sentence professional summary, keyword-dense, tailored to this JD",
  "competencies": ["6-8 keyword phrases from JD mapped to actual skills"],
  "experience": [
    {
      "company": "company name",
      "role": "job title",
      "period": "dates e.g. Jan 2023 – Present",
      "location": "city or Remote",
      "bullets": ["reordered bullet 1 with JD keywords injected", "bullet 2", "bullet 3"]
    }
  ],
  "projects": [
    {
      "title": "project name",
      "badge": "tech badge e.g. Python · React",
      "description": "1-2 sentence description with JD keywords",
      "tech": "comma-separated tech stack"
    }
  ],
  "education": [
    {
      "degree": "degree name",
      "org": "university/institution",
      "year": "graduation year or range",
      "desc": "GPA or relevant coursework (optional)"
    }
  ],
  "certifications": [],
  "skillCategories": [
    {"category": "Languages", "skills": "Python, JavaScript, ..."},
    {"category": "Frameworks", "skills": "React, Node.js, ..."}
  ],
  "atsKeywords": ["15-20 keywords extracted from JD"]
}`;

  const raw = await callAI(prompt);
  const cleaned = raw.replace(/^```json?\s*/m, '').replace(/^```\s*/m, '').replace(/```\s*$/m, '').trim();
  return JSON.parse(cleaned);
}

// ── Fill santifer's cv-template.html placeholders ─────────────────────────────

function buildHtml(data, companyName) {
  // Use absolute font paths so Puppeteer can find them without a server
  const fontUrl = (name) => `file://${FONTS_DIR}/${name}`;

  let template = fs.readFileSync(TEMPLATE_PATH, 'utf8');

  // Fix font src paths to absolute file:// URLs
  template = template
    .replace(/url\('\.\/fonts\/space-grotesk-latin\.woff2'\)/g,   `url('${fontUrl('space-grotesk-latin.woff2')}')`)
    .replace(/url\('\.\/fonts\/space-grotesk-latin-ext\.woff2'\)/g, `url('${fontUrl('space-grotesk-latin-ext.woff2')}')`)
    .replace(/url\('\.\/fonts\/dm-sans-latin\.woff2'\)/g,          `url('${fontUrl('dm-sans-latin.woff2')}')`)
    .replace(/url\('\.\/fonts\/dm-sans-latin-ext\.woff2'\)/g,       `url('${fontUrl('dm-sans-latin-ext.woff2')}')`);

  // Detect format: US companies → letter, rest → a4
  const usCompany = /inc\b|llc\b|corp\b/i.test(companyName) || true; // default letter for US job seeker
  const pageWidth = usCompany ? '8.5in' : '210mm';
  const paperFormat = usCompany ? 'Letter' : 'A4';

  // Build HTML fragments for each section
  const competenciesHtml = (data.competencies || [])
    .map(c => `<span class="competency-tag">${esc(c)}</span>`)
    .join('\n      ');

  const experienceHtml = (data.experience || []).map(job => `
  <div class="job">
    <div class="job-header">
      <span class="job-company">${esc(job.company)}</span>
      <span class="job-period">${esc(job.period)}</span>
    </div>
    <div class="job-role">${esc(job.role)}</div>
    ${job.location ? `<div class="job-location">${esc(job.location)}</div>` : ''}
    <ul>
      ${(job.bullets || []).map(b => `<li>${esc(b)}</li>`).join('\n      ')}
    </ul>
  </div>`).join('\n');

  const projectsHtml = (data.projects || []).map(p => `
  <div class="project">
    <span class="project-title">${esc(p.title)}</span>
    ${p.badge ? `<span class="project-badge">${esc(p.badge)}</span>` : ''}
    <div class="project-desc">${esc(p.description)}</div>
    ${p.tech ? `<div class="project-tech">${esc(p.tech)}</div>` : ''}
  </div>`).join('\n');

  const educationHtml = (data.education || []).map(e => `
  <div class="edu-item">
    <div class="edu-header">
      <span class="edu-title">${esc(e.degree)} — <span class="edu-org">${esc(e.org)}</span></span>
      <span class="edu-year">${esc(e.year)}</span>
    </div>
    ${e.desc ? `<div class="edu-desc">${esc(e.desc)}</div>` : ''}
  </div>`).join('\n');

  const certificationsHtml = (data.certifications || []).length
    ? data.certifications.map(c => `
  <div class="cert-item">
    <span class="cert-title">${esc(c.title)} — <span class="cert-org">${esc(c.org || '')}</span></span>
    <span class="cert-year">${esc(c.year || '')}</span>
  </div>`).join('\n')
    : '<div style="color:#aaa;font-size:10px">—</div>';

  const skillsHtml = (data.skillCategories || []).map(s => `
  <div class="skill-item"><span class="skill-category">${esc(s.category)}:</span> ${esc(s.skills)}</div>
  `).join('\n');

  // Phone: omit span+separator if empty (per santifer template note)
  const phoneHtml = data.phone
    ? `<span>${esc(data.phone)}</span><span class="separator">|</span>`
    : '';

  const replacements = {
    '{{LANG}}': 'en',
    '{{PAGE_WIDTH}}': pageWidth,
    '{{NAME}}': esc(data.candidateName || 'Candidate'),
    '{{PHONE}}': phoneHtml,
    '{{EMAIL}}': esc(data.email || ''),
    '{{LINKEDIN_URL}}': esc(data.linkedin || '#'),
    '{{LINKEDIN_DISPLAY}}': esc(data.linkedinDisplay || data.linkedin || 'LinkedIn'),
    '{{PORTFOLIO_URL}}': esc(data.portfolio || '#'),
    '{{PORTFOLIO_DISPLAY}}': esc(data.portfolioDisplay || data.portfolio || 'Portfolio'),
    '{{LOCATION}}': esc(data.location || ''),
    '{{SECTION_SUMMARY}}': 'Professional Summary',
    '{{SUMMARY_TEXT}}': esc(data.summary || ''),
    '{{SECTION_COMPETENCIES}}': 'Core Competencies',
    '{{COMPETENCIES}}': competenciesHtml,
    '{{SECTION_EXPERIENCE}}': 'Work Experience',
    '{{EXPERIENCE}}': experienceHtml,
    '{{SECTION_PROJECTS}}': 'Projects',
    '{{PROJECTS}}': projectsHtml,
    '{{SECTION_EDUCATION}}': 'Education',
    '{{EDUCATION}}': educationHtml,
    '{{SECTION_CERTIFICATIONS}}': 'Certifications',
    '{{CERTIFICATIONS}}': certificationsHtml,
    '{{SECTION_SKILLS}}': 'Skills',
    '{{SKILLS}}': skillsHtml,
  };

  // The phone placeholder in the template includes its own separator span —
  // replace the entire block when phone is empty
  template = template.replace(
    /<span>\{\{PHONE\}\}<\/span>\s*<span class="separator">\|<\/span>/,
    phoneHtml
  );

  for (const [key, val] of Object.entries(replacements)) {
    if (key === '{{PHONE}}') continue; // already handled
    template = template.split(key).join(val);
  }

  return { html: template, paperFormat };
}

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Generate PDF with Puppeteer ───────────────────────────────────────────────

export async function generateResumePDF(tailoredData, companyName, jobTitle, candidateName) {
  const name = (candidateName || tailoredData.candidateName || 'candidate')
    .toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const company = (companyName || 'company')
    .toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const date = new Date().toISOString().slice(0, 10);

  const filename = `cv-${name}-${company}-${date}.pdf`;
  const pdfPath  = path.join(OUTPUT_DIR, filename);

  const { html, paperFormat } = buildHtml(tailoredData, companyName);

  // Write temp HTML for debugging
  const tmpHtml = path.join(OUTPUT_DIR, `_tmp-${name}-${company}.html`);
  fs.writeFileSync(tmpHtml, html, 'utf8');

  // `networkidle0` waits for all network requests to settle and can hang
  // indefinitely if a font/asset request stalls. `load` is sufficient since
  // all assets are local file:// URLs. Cap with explicit timeouts so the
  // request fails fast instead of timing out the whole HTTP roundtrip.
  let browser;
  try {
    // On ARM64 hosts (Oracle VM) the auto-downloaded Puppeteer Chrome is
    // x86_64 and cannot execute. Set PUPPETEER_EXECUTABLE_PATH in .env to
    // point at the system Chromium (e.g. /usr/bin/chromium-browser) instead.
    const launchOpts = {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      timeout: 30000,
    };
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      launchOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }
    browser = await puppeteer.launch(launchOpts);
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load', timeout: 20000 });
    await page.pdf({
      path: pdfPath,
      format: paperFormat,
      margin: { top: '0.6in', right: '0.6in', bottom: '0.6in', left: '0.6in' },
      printBackground: true,
      timeout: 20000,
    });
  } catch (err) {
    console.error('[resumeGenerator] PDF generation failed:', err && err.stack || err.message);
    throw new Error(`PDF generation failed: ${err.message}`);
  } finally {
    if (browser) { try { await browser.close(); } catch {} }
  }

  console.log(`[resumeGenerator] PDF saved: ${filename}`);
  return { pdfPath, relativePath: `output/${filename}` };
}

// ── saveEvaluationReport re-exported for backward compat ─────────────────────
export { saveEvaluationReport } from './reportManager.js';
