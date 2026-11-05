import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/test';
const { checkResume, isQuantRole, keywordCheck, readCorrections, withCorrections } = await import('../services/tailorPipeline.js');
const { reviewMessage, runMessage } = await import('../services/whatsapp.js');

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

test('corrections: added to the standing rules, read back, replaced and removed', () => {
  const rules = 'Run steps\n1. Read the config.';
  const one = withCorrections(rules, ['Title is Graduate Research Assistant', 'No MS GPA']);
  assert.ok(one.startsWith(rules));
  assert.deepEqual(readCorrections(one), ['Title is Graduate Research Assistant', 'No MS GPA']);
  const two = withCorrections(one, ['Only this']);
  assert.deepEqual(readCorrections(two), ['Only this']);
  assert.equal(two.match(/Master resume corrections/g).length, 1);
  assert.equal(withCorrections(two, []), rules);
  assert.deepEqual(readCorrections(rules), []);
});

test('run message and 9 PM digest say what is ready, and only what applies', () => {
  assert.equal(runMessage({ roles_done: 12, roles_failed: 0 }).subject, '12 resumes ready for review');
  assert.equal(runMessage({ roles_done: 1, roles_failed: 2 }).subject, '1 resume ready for review, 2 failed');
  const full = reviewMessage({ ready: 144, unreviewed: 30, tomorrow: 2, emails: 4 });
  assert.match(full.text, /144 roles ready for review/);
  assert.match(full.text, /30 of them unreviewed for over a day/);
  assert.match(full.text, /2 approved roles due to apply by tomorrow/);
  assert.match(full.text, /4 emails waiting for your OK in Outbox/);
  const quiet = reviewMessage({ ready: 1 }).text;
  assert.doesNotMatch(quiet, /unreviewed|due to apply|Outbox/);
  assert.ok(full.params.body[0].length < 700 && !full.params.body[0].includes('\n'));
});

test('the app writes no resumes and no AI emails unless switched back on', async () => {
  const { start } = await import('../services/resumeEngine.js');
  const { draftPicked } = await import('../services/dailyPlan.js');
  const { draftAsk } = await import('../services/referralFlow.js');
  await assert.rejects(start('u', 1, 'resume'), /no longer writes resumes/);
  assert.equal(await draftPicked('u'), 0);
  const ask = await draftAsk('u', { personName: 'Ana Lee', me: 'Sam Roe', school: 'UIC', major: 'CS', sig: 'Sam', title: 'SWE', company: 'Ramp', jobUrl: '' });
  assert.match(ask.body, /Ana|Dear|Hello/);
});
