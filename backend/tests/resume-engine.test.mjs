import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasTerm, keywordCoverage, normalizeKeywords, atsScore, splitMissing, variants } from '../services/ats.js';
import { numbersIn, unsupportedNumbers, guardDraft, addMissingSkills, SHRINK_STEPS } from '../services/resumeGuard.js';
import { escapeTex, safeUrl, resumeTex } from '../services/latex.js';

const k = (term, extra = {}) => ({ term, aliases: [], importance: 'required', kind: 'hard', ...extra });

test('keyword matching handles the spellings ATS treat as equal', () => {
  assert.ok(hasTerm('Built services in Node.js and React', k('nodejs')));
  assert.ok(hasTerm('Built services in NodeJS', k('Node.js')));
  assert.ok(hasTerm('CI/CD with GitHub Actions', k('github actions')));
  assert.ok(hasTerm('wrote REST APIs', k('REST API')));
  assert.ok(hasTerm('used k8s daily', k('Kubernetes', { aliases: ['k8s'] })));
  assert.ok(hasTerm('C++ and C#', k('C++')));
  assert.ok(!hasTerm('C++ and C#', k('C')));
  assert.ok(!hasTerm('cloud computing', k('C')));
  assert.ok(!hasTerm('JavaScript', k('Java')));
  assert.ok(hasTerm('machine-learning models', k('machine learning')));
  assert.deepEqual(variants('Node.js').includes('nodejs'), true);
});

test('soft skills match by stem; hard skills stay exact', () => {
  const soft = (term) => k(term, { kind: 'soft' });
  assert.ok(hasTerm('collaborated with cross-functional teams', soft('Collaboration')));
  assert.ok(hasTerm('owning the load stage of the migration', soft('Ownership')));
  assert.ok(hasTerm('communicating findings to stakeholders', soft('Communication')));
  assert.ok(hasTerm('strong problem-solving skills', soft('Problem solving')));
  assert.ok(!hasTerm('built my own tool', soft('Ownership')));
  assert.ok(hasTerm('paid attention to detail', soft('Attention to detail')));
  assert.ok(!hasTerm('attention towards detail', soft('Attention to detail')));
  assert.ok(!hasTerm('collaborated with teams', k('Collaboration')));
  assert.ok(hasTerm('solving data access problems for researchers', soft('Problem solving')));
  assert.ok(hasTerm('solved scaling problems', soft('Problem solving')));
  assert.ok(!hasTerm('solved it, then wrote about the problems they had', soft('Problem solving')));
});

test('a degree requirement is met by the degree in any spelling plus the field', () => {
  const edu = 'University of Illinois at Chicago Master of Science, Computer Science Jain University B.Tech, Computer Science and Technology in Artificial Intelligence';
  assert.ok(hasTerm(edu, k("Bachelor's Degree in Computer Science")));
  assert.ok(hasTerm(edu, k("Bachelor's degree in Computer Science or related technical discipline")));
  assert.ok(hasTerm(edu, k("Master's Degree")));
  assert.ok(!hasTerm(edu, k("Bachelor's Degree in Electrical Engineering")));
  assert.ok(!hasTerm('Computer Science coursework', k("Bachelor's Degree in Computer Science")));
});

test('the resume never hyphenates a word across lines', () => {
  assert.match(resumeTex({ name: 'A', contact: {}, education: [], experience: [], projects: [], skills: [], extras: [] }), /\\hyphenpenalty=10000/);
});

test('coverage weighs required over preferred and soft at half', () => {
  const kws = [k('Python'), k('Go', { importance: 'preferred' }), k('communication', { kind: 'soft' })];
  const c = keywordCoverage(kws, 'Python and strong communication');
  // got 3 + 1.5 of 3 + 1.5 + 1.5
  assert.equal(Math.round(c.coverage * 100), Math.round((4.5 / 6) * 100));
  assert.deepEqual(c.missing.map(x => x.term), ['Go']);
});

test('normalizeKeywords drops duplicates and junk', () => {
  const out = normalizeKeywords([{ term: 'Python' }, { term: 'python ' }, { term: '' }, { term: 'Go', importance: 'required', kind: 'hard' }]);
  assert.deepEqual(out.map(x => x.term), ['Python', 'Go']);
  assert.equal(out[0].importance, 'preferred');
});

test('missing keywords split into "you have it" and "you don\'t"', () => {
  const s = splitMissing([k('Docker'), k('Rust')], 'Deployed with Docker');
  assert.deepEqual(s.inSource.map(x => x.term), ['Docker']);
  assert.deepEqual(s.notInSource.map(x => x.term), ['Rust']);
});

test('numbers must come from the original', () => {
  assert.deepEqual(numbersIn('2M+ events, 40% faster, $12K, 1,200 users'), ['2m+', '40%', '12k', '1200']);
  assert.deepEqual(unsupportedNumbers('cut latency 40% for 3x users', 'reduced latency by 40% for users'), ['3x']);
  assert.deepEqual(unsupportedNumbers('cut latency 40%', 'cut latency 40 percent'), []);
});

const MASTER = {
  name: 'Ana Lee', contact: { email: 'ana@x.com', phone: '555-010-2000', location: 'Chicago', links: [] }, summary: '',
  education: [{ school: 'UIC', degree: 'BS', field: 'CS', location: '', start: '2023', end: '2027', gpa: '3.8', details: [] }],
  experience: [
    { id: 'e1', company: 'Acme', title: 'SWE Intern', location: 'Remote', start: 'Jun 2025', end: 'Aug 2025', bullets: ['Built ETL in Python moving 2M rows a day', 'Wrote tests'] },
    { id: 'e2', company: 'Beta', title: 'TA', location: '', start: '2024', end: '2025', bullets: ['Graded labs for 120 students'] },
  ],
  projects: [{ id: 'p1', name: 'Chat App', tech: ['React'], link: '', start: '', end: '', bullets: ['Realtime chat with WebSockets'] }],
  skills: [{ category: 'Languages', items: ['Python', 'Java'] }, { category: 'Tools', items: ['Git'] }],
  extras: [],
};
const REPOS = [{ name: 'rag-search', full_name: 'ana/rag-search', description: 'Hybrid search', topics: ['rag'], languages: { Python: 1, TypeScript: 1 }, readme: 'Retrieval over 10k docs with FastAPI and pgvector', html_url: 'https://github.com/ana/rag-search' }];

test('guard rebuilds from the master and drops invented facts', () => {
  const draft = {
    summary: 'Seasoned engineer with 9 years of Python',
    experience: [{ id: 'e2', bullets: ['Mentored 120 students in labs'] }, { id: 'e1', bullets: ['Built Python ETL moving 2M rows daily', 'Scaled ETL to 5M rows daily'] }, { id: 'zzz', bullets: ['Fake job'] }],
    projects: [
      { source: 'github', ref: 'ana/rag-search', name: 'RAG Search', tech: ['Python', 'FastAPI', 'Kubernetes'], bullets: ['Retrieval over 10k docs via FastAPI', 'Served 1M queries'] },
      { source: 'github', ref: 'ana/nope', name: 'Ghost', tech: [], bullets: ['x'] },
      { source: 'resume', ref: 'p1', name: 'Chat App', tech: ['React'], bullets: ['Realtime chat using WebSockets'] },
    ],
    skills: [{ category: 'Languages', items: ['Python', 'Rust', 'TypeScript'] }],
  };
  const { doc, removed } = guardDraft(draft, MASTER, REPOS);
  assert.equal(doc.summary, '');
  assert.deepEqual(doc.experience.map(e => e.id), ['e1', 'e2']);
  assert.deepEqual(doc.experience[0].bullets, ['Built Python ETL moving 2M rows daily']);
  assert.equal(doc.experience[0].company, 'Acme');
  assert.deepEqual(doc.projects.map(p => p.name), ['RAG Search', 'Chat App']);
  assert.deepEqual(doc.projects[0].tech, ['Python', 'FastAPI']);
  assert.deepEqual(doc.projects[0].bullets, ['Retrieval over 10k docs via FastAPI']);
  assert.equal(doc.projects[0].link, 'https://github.com/ana/rag-search');
  assert.deepEqual(doc.skills[0].items, ['Python', 'TypeScript']);
  const why = removed.map(r => r.what);
  for (const x of ['Seasoned engineer with 9 years of Python', 'Scaled ETL to 5M rows daily', 'Kubernetes', 'Served 1M queries', 'Ghost', 'Rust']) assert.ok(why.includes(x), `removed ${x}`);
});

test('addMissingSkills only adds what it is given, once', () => {
  const { doc, added } = addMissingSkills({ skills: [{ category: 'Languages', items: ['Python'] }, { category: 'Tools', items: ['Git'] }] }, [k('Docker'), k('git'), k('teamwork', { kind: 'soft' })]);
  assert.deepEqual(added, ['Docker']);
  assert.deepEqual(doc.skills[1].items, ['Git', 'Docker']);
});

test('shrink steps always make progress and end', () => {
  let d = { ...MASTER, projects: [1, 2, 3].map(i => ({ name: `p${i}`, tech: [], bullets: ['a', 'b', 'c'] })), experience: MASTER.experience.map(e => ({ ...e, bullets: ['1', '2', '3', '4', '5'] })), extras: [{ heading: 'A', items: ['1', '2', '3', '4'] }, { heading: 'B', items: ['x'] }] };
  let steps = 0;
  for (const step of SHRINK_STEPS) { const n = step(d); if (n) { d = n; steps++; } }
  assert.ok(steps >= 6);
  assert.equal(d.projects.length, 1);
  assert.equal(d.experience[0].bullets.length, 2);
});

test('ATS score is 85% keywords + 15% format', () => {
  const doc = { ...MASTER };
  const text = `Ana Lee ana@x.com ${'Python '.repeat(80)}`;
  const r = atsScore({ keywords: [k('Python'), k('Go')], pdfText: text, doc, pages: 1 });
  assert.equal(r.coverage, 50);
  assert.ok(r.score >= 55 && r.score <= 58, `score ${r.score}`);
});

test('LaTeX escaping cannot inject commands', () => {
  const t = escapeTex('\\input{/etc/passwd} \\write18{rm} $x$ 100% #1 a_b {c}');
  assert.ok(!/\\input|\\write18/.test(t.replace(/\\textbackslash\{\}/g, '')));
  assert.ok(t.includes('100\\%') && t.includes('\\#1') && t.includes('a\\_b') && t.includes('\\{c\\}') && t.includes('\\$x\\$'));
  assert.equal(safeUrl('javascript:alert(1)'), '');
  assert.equal(safeUrl('github.com/ana'), 'https://github.com/ana');
  assert.equal(safeUrl('https://x.com/a%20b#c'), 'https://x.com/a\\%20b\\#c');
  const tex = resumeTex(MASTER);
  assert.ok(tex.includes('\\section*{EXPERIENCE}') && tex.includes('SWE Intern'));
});

test('master text includes dates and GPA, so they count as real', async () => {
  const { masterText } = await import('../services/resumeGuard.js');
  const t = masterText(MASTER);
  for (const x of ['Jun 2025', '2027', '3.8', 'Acme', 'Graded labs for 120 students']) assert.ok(t.includes(x), x);
  assert.deepEqual(unsupportedNumbers('Interned in Jun 2025; GPA 3.8; class of 2027', t), []);
});
