import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  metricSpans, hasMetric, fixDashes, bulletIssues, varyVerbs, equalizeBullets, experienceSections, sortNewestFirst,
  orderSkills, orderCertifications, roleKind, applyRules, lintDoc, keywordPlaces, boldTools, CHARS_PER_LINE,
} from '../services/resumeRules.js';
import { richText, checkPreamble, resumeTex, RESUME_PREAMBLE } from '../services/latex.js';

const k = (term, o = {}) => ({ term, aliases: [], importance: 'required', kind: 'hard', tool: true, ...o });
const metrics = (s) => metricSpans(s).map(m => m.text);

test('metrics are real results, not versions, names or years', () => {
  assert.deepEqual(metrics('achieving 82.5% detection accuracy'), ['82.5%']);
  assert.deepEqual(metrics('processing 500GB+ daily telemetry for 500+ users'), ['500GB+', '500+']);
  assert.deepEqual(metrics('reaching 83ns p50 latency and 36K+ orders per second'), ['83ns', '36K+']);
  assert.deepEqual(metrics('with 32 Google Test cases'), ['32']);
  assert.deepEqual(metrics('Served 1,200 users'), ['1,200']);
  assert.deepEqual(metrics('over 10k docs'), ['10k']);
  assert.deepEqual(metrics('saved $12K a year'), ['$12K']);
  for (const s of ['engine in C++17', 'using GPT-4 prompts', 'Groq Llama 3.3 70B, and GPT', 'a Next.js 15 frontend', 'built for Prophet Hacks 2026', 'a 2-step flow', 'wrote Python 3 scripts']) {
    assert.deepEqual(metrics(s), [], s);
  }
  assert.ok(hasMetric('cut costs by 15%'));
  assert.ok(!hasMetric('Built a RAG pipeline with LangChain'));
});

test('ATS equivalents: RESTful ≈ REST, CI/CD, LLMs; no false hits', async () => {
  const { hasTerm } = await import('../services/ats.js');
  assert.ok(hasTerm('Python, REST APIs, WebSockets', k('RESTful API')));
  assert.ok(hasTerm('Shipped with CI/CD on GitHub Actions', k('CI/CD')));
  assert.ok(hasTerm('Built LLMs tooling', k('LLM')));
  assert.ok(!hasTerm('cloud and C++', k('C')));
});

test('a project to build stays on the page only if the ATS rule still holds', async () => {
  const { keepProjectOnPage, atsPasses } = await import('../services/ats.js');
  assert.equal(atsPasses(90), false);
  assert.equal(atsPasses(91), true);
  assert.equal(keepProjectOnPage(93, 89), false); // pushed keywords off a passing page
  assert.equal(keepProjectOnPage(80, 86), true);  // still under, but better
  assert.equal(keepProjectOnPage(85, 92), true);
  assert.equal(keepProjectOnPage(85, null), false);
});

test('the change report is computed: before/after per bullet, why = keywords added', async () => {
  const { diffChanges } = await import('../services/resumeRules.js');
  const master = {
    summary: '',
    experience: [{ id: 'e1', title: 'SWE', company: 'Acme', bullets: ['Built ETL pipelines with Python', 'Made dashboards'] }],
    projects: [{ id: 'p1', name: 'Chat', bullets: ['Realtime chat'] }, { id: 'p2', name: 'Old', bullets: ['x'] }],
    skills: [{ category: 'Languages', items: ['Python'] }, { category: 'Cloud', items: ['AWS'] }],
  };
  const doc = {
    summary: '',
    experience: [{ id: 'e1', title: 'SWE', company: 'Acme', bullets: ['Built ETL pipelines with Python and Apache Spark', 'Made dashboards'] }],
    projects: [{ name: 'Chat', source: 'resume', ref: 'p1', bullets: ['Realtime chat'] }, { name: 'rag-search', source: 'github', ref: 'ana/rag-search', bullets: ['RAG'] }],
    skills: [{ category: 'Cloud', items: ['AWS'] }, { category: 'Languages', items: ['Python'] }],
  };
  const c = diffChanges(master, doc, [k('Apache Spark'), k('Python')], { 'ana/rag-search': 'Proves RAG' });
  assert.deepEqual(c.map(x => [x.section, x.before, x.after, x.why]), [
    ['SWE at Acme', 'Built ETL pipelines with Python', 'Built ETL pipelines with Python and Apache Spark', 'Adds Apache Spark'],
    ['Projects', '', 'rag-search', 'Proves RAG'],
    ['Projects', 'Old', '', 'Left out: less relevant to this job, to keep one page'],
    ['Technical Skills', 'Languages, Cloud', 'Cloud, Languages', 'Most relevant groups first, at most 6 groups of 8'],
  ]);
});

test('gaps across roles: counted once per role, skills you show left out, most asked first', async () => {
  const { gapsAcross } = await import('../services/resumeRules.js');
  const roles = [
    [k('LangGraph'), k('Python'), k('Go', { importance: 'preferred' })],
    [k('LangGraph'), k('LangGraph'), k('Kubernetes')],
    [k('Go'), k('LangGraph', { importance: 'preferred' }), k('teamwork', { kind: 'soft' })],
  ];
  const gaps = gapsAcross(roles, 'Python, Docker, AWS');
  assert.deepEqual(gaps.map(g => [g.term, g.roles, g.required]), [['LangGraph', 3, 2], ['Go', 2, 1], ['Kubernetes', 1, 1]]);
});

test('dashes and filler are caught; dashes become commas', () => {
  assert.equal(fixDashes('Built a tool — fast and simple'), 'Built a tool, fast and simple');
  assert.equal(fixDashes('Built a tool---fast'), 'Built a tool, fast');
  assert.equal(fixDashes('ambulance-to-hospital triage'), 'ambulance-to-hospital triage');
  assert.deepEqual(bulletIssues('Responsible for ETL jobs').map(i => i.code), ['filler']);
  assert.deepEqual(bulletIssues('Helped the team ship — quickly').map(i => i.code), ['dash', 'filler']);
});

test('bullets: two lines fine, a short third line not, a full third line fine', () => {
  const words = (n) => 'x'.repeat(n);
  assert.deepEqual(bulletIssues(words(2 * CHARS_PER_LINE)), []);
  assert.deepEqual(bulletIssues(words(2 * CHARS_PER_LINE + 20)).map(i => i.code), ['length']);
  assert.deepEqual(bulletIssues(words(Math.ceil(2.9 * CHARS_PER_LINE))), []);
  assert.deepEqual(bulletIssues(words(4 * CHARS_PER_LINE)).map(i => i.code), ['length']);
});

test('no two bullets in a row start with the same verb', () => {
  assert.deepEqual(varyVerbs(['Built A', 'Built B', 'Built C']), ['Built A', 'Developed B', 'Built C']);
  assert.deepEqual(varyVerbs(['Built A', 'Led B']), ['Built A', 'Led B']);
});

test('every entry in a section gets the same number of bullets', () => {
  const r = equalizeBullets([
    { title: 'SWE', company: 'A', bullets: ['1', '2', '3', '4'] },
    { title: 'Intern', company: 'B', bullets: ['1', '2', '3'] },
    { title: 'Viz', company: 'C', bullets: ['1'] },
  ], 'Industry Experience');
  assert.deepEqual(r.entries.map(e => e.bullets.length), [3, 3]);
  assert.ok(r.removed.some(x => x.what === 'Viz at C'));
  // A pinned project (built for this role) stays even with one bullet.
  const p = equalizeBullets([{ name: 'A', bullets: ['1', '2'] }, { name: 'Built', keep: true, bullets: ['1'] }], 'Projects');
  assert.deepEqual(p.entries.map(e => e.bullets.length), [1, 1]);
});

test('Research before Industry, Industry first for quant roles', () => {
  const exp = [
    { section: 'Industry Experience', company: 'Mercedes' },
    { section: 'Research Experience', company: 'UIC' },
    { section: 'Leadership', company: 'CSGSA' },
  ];
  assert.deepEqual(experienceSections(exp).map(g => g.heading), ['Research Experience', 'Industry Experience', 'Leadership']);
  assert.deepEqual(experienceSections(exp, { quant: true }).map(g => g.heading), ['Industry Experience', 'Research Experience', 'Leadership']);
});

test('projects newest first', () => {
  const ps = [{ name: 'old', start: 'Nov 2024', end: 'Jan 2025' }, { name: 'new', start: 'Apr 2026', end: 'Jun 2026' }, { name: 'may', end: 'May 2026' }, { name: 'now', start: 'Sep 2025', end: 'Present' }];
  assert.deepEqual(sortNewestFirst(ps).map(p => p.name), ['now', 'new', 'may', 'old']);
});

test('skills: most relevant group first, at most 6 groups of 8', () => {
  const skills = [
    { category: 'Web', items: ['React', 'Node.js'] },
    { category: 'ML', items: ['PyTorch', 'TensorFlow', 'a', 'b', 'c', 'd', 'e', 'f', 'Hugging Face'] },
    ...['g1', 'g2', 'g3', 'g4', 'g5'].map(c => ({ category: c, items: ['x'] })),
  ];
  const out = orderSkills(skills, [k('PyTorch'), k('Hugging Face')]);
  assert.equal(out[0].category, 'ML');
  assert.equal(out.length, 6);
  assert.equal(out[0].items.length, 8);
  assert.deepEqual(out[0].items.slice(0, 2), ['PyTorch', 'Hugging Face']);
});

test('Bloomberg Market Concepts first for finance roles, last otherwise', () => {
  const extras = [{ heading: 'Certifications', items: ['Bloomberg Market Concepts', 'IBM Machine Learning Professional', 'Google Cloud Associate'] }];
  assert.equal(orderCertifications(extras, { finance: true })[0].items[0], 'Bloomberg Market Concepts');
  assert.equal(orderCertifications(extras, { finance: false })[0].items.at(-1), 'Bloomberg Market Concepts');
});

test('role kind: quant/C++ vs finance vs neither', () => {
  assert.deepEqual(roleKind({ title: 'Quantitative Developer' }), { quant: true, finance: true });
  assert.deepEqual(roleKind({ title: 'C++ Software Engineer' }).quant, true);
  assert.deepEqual(roleKind({ title: 'Software Engineer, New Grad', company: 'Capital One', description: 'Build our banking platform for financial services and investment products.' }), { quant: false, finance: true });
  assert.deepEqual(roleKind({ title: 'Software Engineer, New Grad', company: 'Whatnot', description: 'live shopping marketplace' }), { quant: false, finance: false });
});

test('applyRules: project numbers only for quant roles, rules fixed, report lists it', () => {
  const doc = {
    summary: '',
    experience: [{ section: 'Industry Experience', title: 'SWE', company: 'A', bullets: ['Built ETL — fast', 'Built dashboards cutting cost 15%'] }],
    projects: [{ name: 'Order Book', end: 'Jun 2026', bullets: ['Reached 83ns p50 latency in C++17', 'Exposed the engine through FastAPI'] }, { name: 'FinPath', end: 'Dec 2025', bullets: ['Built a chatbot with LangChain', 'Ran user research'] }],
    skills: [{ category: 'Languages', items: ['Python'] }],
    extras: [],
    education: [],
  };
  const swe = applyRules(doc, { keywords: [k('Python')], kind: { quant: false, finance: false } });
  // Order Book lost its metric bullet, so it can't match FinPath's two and drops out.
  assert.deepEqual(swe.doc.projects.map(p => [p.name, p.bullets.length]), [['FinPath', 2]]);
  assert.ok(swe.removed.some(r => /quant/.test(r.why)));
  assert.equal(swe.doc.experience[0].bullets[0], 'Built ETL, fast');
  assert.equal(swe.doc.experience[0].bullets[1], 'Developed dashboards cutting cost 15%');
  const quant = applyRules(doc, { keywords: [], kind: { quant: true, finance: true } });
  assert.ok(quant.doc.projects[0].bullets[0].includes('83ns'));
  assert.deepEqual(lintDoc(quant.doc, { kind: { quant: true } }), []);
});

test('lintDoc flags uneven sections and repeated verbs', () => {
  const doc = { experience: [{ section: 'Experience', title: 'A', company: 'X', bullets: ['Built a', 'Built b'] }, { section: 'Experience', title: 'B', company: 'Y', bullets: ['Led c'] }], projects: [] };
  const codes = lintDoc(doc).map(i => i.code).sort();
  assert.deepEqual(codes, ['count', 'verb']);
});

test('keywords table says where each keyword sits', () => {
  const doc = { summary: '', experience: [{ section: 'Industry Experience', title: 'SWE', company: 'A', bullets: ['Built Kafka pipelines'] }], projects: [{ name: 'P', tech: [], bullets: ['React app'] }], skills: [{ category: 'Languages', items: ['Python', 'Kafka'] }], education: [], extras: [] };
  const t = keywordPlaces(doc, [k('Kafka'), k('React'), k('Go')]);
  assert.deepEqual(t.map(x => x.where), [['Industry Experience', 'Technical Skills'], ['Projects'], []]);
});

test('bold: metrics and the job’s tools, escaped, never a command', () => {
  const out = richText('Built ETL with Python and Apache Spark processing 500GB+ daily', { terms: boldTools([k('Python'), k('Apache Spark'), k('teamwork', { kind: 'soft' })]), metricSpans });
  assert.equal(out, 'Built ETL with \\textbf{Python} and \\textbf{Apache Spark} processing \\textbf{500GB+} daily');
  const evil = richText('Used \\input{/etc/passwd} and 100% effort', { terms: ['\\input'], metricSpans });
  assert.ok(!/\\input\{/.test(evil.replace(/\\textbackslash\{\}/g, '')));
  assert.ok(evil.includes('\\textbf{100\\%}'));
  assert.equal(richText('C++17 engine with GPT-4', { terms: [], metricSpans }), 'C++17 engine with GPT-4');
});

test('the user’s template is accepted; unsafe preambles are not', () => {
  const user = `${RESUME_PREAMBLE.replace('[hidelinks]{hyperref}', '{fontawesome}\n\\usepackage{hyperref}')}\n\\begin{document}\nbody\n\\end{document}`;
  const ok = checkPreamble(user);
  assert.equal(ok.ok, true);
  assert.ok(ok.preamble.includes('\\usepackage{fontawesome}') && !ok.preamble.includes('body'));
  assert.equal(checkPreamble('\\documentclass{article}\n\\immediate\\write18{ls}').ok, false);
  assert.equal(checkPreamble('\\documentclass{article}\n\\input{/etc/passwd}').ok, false);
  assert.equal(checkPreamble('\\documentclass{article}\n\\input /etc/passwd').ok, false);
  assert.equal(checkPreamble('\\documentclass{article}\n% \\write18 in a comment is fine').ok, true);
  assert.equal(checkPreamble('no class here').ok, false);
  assert.ok(checkPreamble('\\documentclass{article}').preamble.includes('hyperref'));
});

test('resume body follows the template: sections, header labels, certifications in skills', () => {
  const doc = {
    name: 'Ana Lee',
    contact: { email: 'ana@x.com', phone: '(312) 555-0100', location: 'Chicago, IL', links: [{ label: 'LinkedIn', url: 'https://www.linkedin.com/in/ana-l' }, { label: 'GitHub', url: 'https://github.com/ana' }, { label: 'Site', url: 'https://ana.dev' }] },
    summary: '',
    education: [{ school: 'UIC', degree: 'Master of Science', field: 'Computer Science', location: 'Chicago, IL', start: 'Aug 2025', end: 'May 2027', gpa: '3.3', details: ['Coursework: ML'] }],
    experience: [{ section: 'Research Experience', company: 'UIC Lab', title: 'Research Assistant', location: 'Chicago, IL', start: 'Oct 2025', end: 'Present', bullets: ['Build RAG pipelines'] }],
    projects: [{ name: 'Order Book | Matching Engine', start: 'Apr 2026', end: 'Jun 2026', bullets: ['Built it'] }],
    skills: [{ category: 'Languages', items: ['Python', 'C++'] }],
    extras: [{ heading: 'Certifications', items: ['Bloomberg Market Concepts'] }, { heading: 'Publications', items: ['Semantic Segmentation for Self-Driving Cars in IJRESM'] }],
  };
  const tex = resumeTex(doc, { metricSpans });
  for (const x of ['\\section*{RESEARCH EXPERIENCE}', '\\section*{TECHNICAL SKILLS}', '{LinkedIn/ana-l}', '{GitHub/ana}', '{ana.dev}', 'Chicago, IL \\; $|$ \\;',
    '\\textit{Master of Science in Computer Science} \\textbar{} GPA 3.3', '\\textbf{Certifications} -- Bloomberg Market Concepts', '\\textit{Semantic Segmentation for Self-Driving Cars} in IJRESM',
    '\\textbf{Order Book \\textbar{} Matching Engine} \\hfill Apr 2026 -- Jun 2026']) {
    assert.ok(tex.includes(x), x);
  }
  assert.ok(!/relocat/i.test(tex));
  assert.ok(resumeTex({ ...doc, projects: [{ name: 'One', start: 'May 2026', end: 'May 2026', bullets: ['x'] }] }).includes('\\hfill May 2026\n'));
  assert.ok(!tex.includes('\\section*{CERTIFICATIONS}'));
});
