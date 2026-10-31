import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  metricSpans, hasMetric, fixDashes, bulletIssues, varyVerbs, equalizeBullets, experienceSections, sortNewestFirst,
  orderSkills, orderCertifications, roleKind, applyRules, lintDoc, placeholders, fillPlaceholders, keywordPlaces, boldTools, CHARS_PER_LINE, MIN_BULLET_CHARS, showGpa,
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
  assert.ok(hasTerm('moving data to the Azure modern data platform', k('Modern Data Platforms')));
  assert.ok(hasTerm('relational database design', k('Relational Databases')));
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
  // Generic words aren't gaps; CI/CD and Continuous Integration are one skill.
  const g2 = gapsAcross([[k('Software Engineering'), k('Debugging'), k('CI/CD')], [k('Continuous Integration'), k('Object\u2011oriented programming')]], 'Python');
  assert.deepEqual(g2.map(g => [g.term, g.roles]), [['CI/CD', 2]]);
});

test('skills to ask about: hard skills nothing you shared shows, not soft ones', async () => {
  const { skillsToAsk } = await import('../services/resumeRules.js');
  const t = { ats: { keywords: [k('Kafka'), k('teamwork', { kind: 'soft' }), k('Go')], missingYouDont: [{ term: 'Kafka' }, { term: 'teamwork' }, { term: 'Go' }] } };
  assert.deepEqual(skillsToAsk(t), ['Kafka', 'Go']);
});

test('project demand: examples favour roles asking for what this idea adds beyond the shared gap', async () => {
  const { demandFor } = await import('../services/resumeRules.js');
  const roles = [{ company_name: 'A', title: 'SWE' }, { company_name: 'B', title: 'SWE' }, { company_name: 'C', title: '.NET Dev' }];
  const kw = [[k('CI/CD')], [k('CI/CD')], [k('C#'), k('Continuous Integration')]];
  const d = demandFor(['CI/CD', 'C#'], kw, roles, ['CI/CD']);
  assert.equal(d.roles, 3);
  assert.deepEqual(d.examples, ['C · .NET Dev']);
  assert.deepEqual(d.keywords, [{ term: 'CI/CD', roles: 3 }, { term: 'C#', roles: 1 }]);
});

test('dashes and filler are caught; dashes become commas', () => {
  assert.equal(fixDashes('Built a tool — fast and simple'), 'Built a tool, fast and simple');
  assert.equal(fixDashes('Built a tool---fast'), 'Built a tool, fast');
  assert.equal(fixDashes('ambulance-to-hospital triage'), 'ambulance-to-hospital triage');
  assert.deepEqual(bulletIssues('Responsible for ETL jobs').map(i => i.code), ['filler', 'short']);
  assert.deepEqual(bulletIssues('Helped the team ship — quickly').map(i => i.code), ['dash', 'filler', 'short']);
});

test('bullets: two lines fine, a short third line not, a full third line fine', () => {
  const words = (n) => 'x'.repeat(n);
  assert.deepEqual(bulletIssues(words(2 * CHARS_PER_LINE)), []);
  assert.deepEqual(bulletIssues(words(2 * CHARS_PER_LINE + 20)).map(i => i.code), ['length']);
  assert.deepEqual(bulletIssues(words(Math.ceil(2.9 * CHARS_PER_LINE))), []);
  assert.deepEqual(bulletIssues(words(4 * CHARS_PER_LINE)).map(i => i.code), ['length']);
});

test('bullets: a thin second line is short; the user\'s own 160–200 character bullets are fine', () => {
  const ibm = 'Build automated data extraction pipelines that turn cancer patient records into structured clinical and genomic datasets for researchers and clinicians.';
  const fedex = 'Automated data extraction pipelines that clean, map, and convert raw cancer patient records into structured clinical and genomic datasets, giving researchers analysis-ready data.';
  assert.deepEqual(bulletIssues(ibm).map(i => i.code), ['short']);
  assert.deepEqual(bulletIssues(fedex), []);
  assert.deepEqual(bulletIssues('x'.repeat(MIN_BULLET_CHARS)), []);
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

test('the main job in an experience section may keep up to 4 bullets; the rest match', () => {
  const r = equalizeBullets([
    { title: 'SWE', company: 'Mercedes', bullets: ['1', '2', '3', '4', '5'] },
    { title: 'Intern', company: 'Leaf', bullets: ['1', '2', '3'] },
    { title: 'Analyst', company: 'C', bullets: ['1', '2'] },
  ], 'Industry Experience', { lead: true });
  assert.deepEqual(r.entries.map(e => e.bullets.length), [4, 2, 2]);
  assert.ok(r.removed.some(x => x.where === 'SWE at Mercedes' && /main job/.test(x.why)));
  const lint = lintDoc({ experience: r.entries.map(e => ({ ...e, section: 'Industry Experience' })), projects: [] });
  assert.ok(!lint.some(x => x.code === 'count'));
  // Without lead (projects) every entry matches.
  assert.deepEqual(equalizeBullets([{ name: 'A', bullets: ['1', '2', '3'] }, { name: 'B', bullets: ['1', '2'] }], 'Projects').entries.map(e => e.bullets.length), [2, 2]);
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
  // C++ inside a list of languages, however often, isn't a C++ role (Microsoft FDE)
  const list = 'coding in languages including, but not limited to, C, C++, C#, Java, JavaScript, or Python. ';
  assert.deepEqual(roleKind({ title: 'Software Engineer - Forward Deployed Engineer', company: 'Microsoft', description: list.repeat(3) }), { quant: false, finance: false });
  assert.equal(roleKind({ title: 'Software Engineer', description: 'Write modern C++. Profile C++ services. Own our C++ toolchain.' }).quant, true);
});

test('applyRules: real project numbers stay for every role, rules fixed', () => {
  const doc = {
    summary: '',
    experience: [{ section: 'Industry Experience', title: 'SWE', company: 'A', bullets: ['Built ETL — fast', 'Built dashboards cutting cost 15%'] }],
    projects: [{ name: 'Order Book', end: 'Jun 2026', bullets: ['Reached 83ns p50 latency in C++17', 'Exposed the engine through FastAPI'] }, { name: 'FinPath', end: 'Dec 2025', bullets: ['Built a chatbot with LangChain', 'Ran user research'] }],
    skills: [{ category: 'Languages', items: ['Python'] }],
    extras: [],
    education: [],
  };
  const swe = applyRules(doc, { keywords: [k('Python')], kind: { quant: false, finance: false } });
  // Numbers the material states stay in project bullets for any role (the user's call, 2026-10-27).
  assert.deepEqual(swe.doc.projects.map(p => [p.name, p.bullets.length]), [['Order Book', 2], ['FinPath', 2]]);
  assert.ok(swe.doc.projects[0].bullets[0].includes('83ns'));
  const ruleIssues = (d, kind) => lintDoc(d, { kind }).filter(x => x.code !== 'short');
  assert.deepEqual(ruleIssues(swe.doc, { quant: false }), []);
  assert.equal(swe.doc.experience[0].bullets[0], 'Built ETL, fast');
  assert.equal(swe.doc.experience[0].bullets[1], 'Developed dashboards cutting cost 15%');
  const quant = applyRules(doc, { keywords: [], kind: { quant: true, finance: true } });
  assert.ok(quant.doc.projects[0].bullets[0].includes('83ns'));
  assert.deepEqual(ruleIssues(quant.doc, { quant: true }), []);
});

test('lintDoc flags uneven sections (past the main job) and repeated verbs', () => {
  const doc = { experience: [{ section: 'Experience', title: 'A', company: 'X', bullets: ['Built a', 'Built b', 'Led z'] }, { section: 'Experience', title: 'B', company: 'Y', bullets: ['Led c', 'Ran d'] }, { section: 'Experience', title: 'C', company: 'Z', bullets: ['Led e'] }], projects: [] };
  const codes = lintDoc(doc).map(i => i.code).filter(c => c !== 'short').sort();
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

test('targets in a planned project: listed in order, filled with the real numbers', () => {
  const bullets = ['Engineered a Spring Boot API screening [1,000] patient profiles in under [2 s].', 'Built a React UI for reviewing results.'];
  assert.deepEqual(placeholders(bullets), ['1,000', '2 s']);
  assert.deepEqual(fillPlaceholders(bullets, ['1,200', '1.4 s']), ['Engineered a Spring Boot API screening 1,200 patient profiles in under 1.4 s.', 'Built a React UI for reviewing results.']);
  assert.deepEqual(placeholders(['no targets here']), []);
});

test('a GPA under 3.5 shows only when the job asks about GPA', () => {
  assert.equal(showGpa('3.26', 'Build APIs in Java.'), false);
  assert.equal(showGpa('3.26', 'Minimum GPA of 3.0 required.'), true);
  assert.equal(showGpa('3.92', 'Build APIs in Java.'), true);
  assert.equal(showGpa('GPA: 3.4/4.0', 'cumulative grade point average'), true);
  assert.equal(showGpa('8.9/10', 'Build APIs'), true);
  assert.equal(showGpa('', 'GPA 3.0'), false);
  const doc = { experience: [], projects: [], skills: [], extras: [], education: [{ school: 'UIC', gpa: '3.26' }, { school: 'Jain', gpa: '3.92' }] };
  assert.deepEqual(applyRules(doc, { jd: 'Java role' }).doc.education.map(e => e.gpa), ['', '3.92']);
  assert.deepEqual(applyRules(doc, {}).doc.education.map(e => e.gpa), ['3.26', '3.92']);
});
