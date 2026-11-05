import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/test';
const { checkResume, isQuantRole, keywordCheck } = await import('../services/tailorPipeline.js');

test('resume check: a clean one-page resume passes', () => {
  assert.deepEqual(checkResume({ text: 'Master of Science in Computer Science\nB.Tech in AI | GPA 3.92\nJan 2024 – May 2026', pages: 1 }), []);
});

test('resume check: each rule is caught', () => {
  const one = (text, extra = {}) => checkResume({ text, pages: 1, ...extra });
  assert.match(checkResume({ text: 'x', pages: 2 })[0], /2 pages/);
  assert.match(checkResume({ text: 'x', pages: null })[0], /unknown/);
  assert.match(one('built it — fast')[0], /em dash/);
  assert.match(one('Master of Science | GPA 3.9')[0], /MS GPA/);
  assert.match(one('Willing to relocate')[0], /relocation/);
  assert.match(one('Processed 500GB+ of\nsensor data daily')[0], /daily/);
  assert.match(one('reaching 83ns p50 latency')[0], /83ns/);
  assert.match(one('handling 36K+ orders per second')[0], /36K\+ orders/);
});

test('resume check: latency numbers are fine on a quant role, and one dataset is fine anywhere', () => {
  assert.deepEqual(checkResume({ text: 'reaching 83ns p50 latency and 36K+ orders', pages: 1, quant: true }), []);
  assert.deepEqual(checkResume({ text: 'A 500GB+ dataset for ML training. Daily standups.', pages: 1 }), []);
});

test('quant role: a trading firm with a plain title counts, a data analyst does not', () => {
  const aquatic = 'challenges in global financial markets. You will work with quantitative researchers.';
  assert.equal(isQuantRole({ title: 'Software Engineer, Early Career', company: 'Aquatic', description: aquatic }), true);
  assert.equal(isQuantRole({ title: 'Data Analyst', company: 'Emory', description: 'quantitative analysis of clinical data' }), false);
  assert.equal(isQuantRole({ title: 'Quant Developer' }), true);
});

test('keyword check: spacing and case do not matter, and either side of a slash counts', () => {
  const table = [{ keyword: 'Python' }, { keyword: 'TypeScript / React' }, { keyword: 'CI/CD' }, { keyword: 'Legal domain' }, {}];
  assert.deepEqual(keywordCheck('PYTHON, react\nand CI / CD', table), { found: 3, total: 4, missing: ['Legal domain'] });
  assert.deepEqual(keywordCheck('x', null), { found: 0, total: 0, missing: [] });
});
