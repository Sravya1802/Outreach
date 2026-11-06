import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/test';
const { checkOutreach, checkResume, isQuantRole, keywordCheck, readCorrections, withCorrections } = await import('../services/tailorPipeline.js');
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

test('keyword check: spacing and case do not matter', () => {
  const table = [{ keyword: 'Python' }, { keyword: 'CI/CD' }, { keyword: 'Legal domain' }, {}];
  assert.deepEqual(keywordCheck('PYTHON, react\nand CI / CD', table), { found: 2, total: 3, present: ['Python', 'CI/CD'], missing: ['Legal domain'] });
  assert.deepEqual(keywordCheck('x', null), { found: 0, total: 0, present: [], missing: [] });
});

test('keyword check: reads a table written as { keyword: where }', () => {
  assert.deepEqual(keywordCheck('Python and Kubernetes', { Python: 'Skills', Kafka: 'Projects' }), { found: 1, total: 2, present: ['Python'], missing: ['Kafka'] });
  assert.deepEqual(keywordCheck('x', 'not a table'), { found: 0, total: 0, present: [], missing: [] });
});

test('keyword check: whole words only', () => {
  const missing = (text, keyword) => keywordCheck(text, { [keyword]: 'Skills' }).missing.length === 1;
  assert.equal(missing('JavaScript and TypeScript', 'Java'), true);
  assert.equal(missing('Java and JavaScript', 'Java'), false);
  assert.equal(missing('Google Cloud', 'Go'), true);
  assert.equal(missing('we go fast', 'Go'), true);
  assert.equal(missing('Go, Rust', 'Go'), false);
  assert.equal(missing('C++ and C#', 'C'), true);
  assert.equal(missing('C++ and C#', 'C++'), false);
  assert.equal(missing('C++ and C#', 'C#'), false);
  assert.equal(missing('NoSQL stores', 'SQL'), true);
  assert.equal(missing('a rag', 'RAG'), true);
});

test('keyword check: a whole word survives line ends, hyphens and plurals', () => {
  const found = (text, keyword) => keywordCheck(text, { [keyword]: 'Skills' }).found === 1;
  assert.equal(found('built micro-\nservices', 'Microservices'), true);
  assert.equal(found('distributed\nsystems', 'Distributed systems'), true);
  assert.equal(found('end-to-end', 'End to end'), true);
  assert.equal(found('REST APIs', 'API'), true);
  assert.equal(found('an LLM', 'LLMs'), true);
  assert.equal(found('Node.js', 'NodeJS'), true);
});

test('keyword check: each side of "A / B" stands alone, and "CI/CD" does not split', () => {
  assert.deepEqual(keywordCheck('AWS only', [{ keyword: 'AWS / Azure / GCP' }]), { found: 1, total: 3, present: ['AWS'], missing: ['Azure', 'GCP'] });
  assert.deepEqual(keywordCheck('CI pipelines', [{ keyword: 'CI/CD' }]), { found: 0, total: 1, present: [], missing: ['CI/CD'] });
  assert.equal(keywordCheck('Python', [{ keyword: 'Python' }, { keyword: 'Python / Go' }]).total, 2);
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

test('run message: outreach written on its own is announced', () => {
  assert.equal(runMessage({ roles_done: 0, outreach: 3 }).subject, 'outreach written for 3 roles');
  assert.equal(runMessage({ roles_done: 2, outreach: 1 }).subject, '2 resumes ready for review, outreach written for 1 role');
  assert.equal(runMessage({ roles_done: 2 }).subject, '2 resumes ready for review');
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

test('fit score: another field or a clearance title can not score as a fit', async () => {
  const { capScore } = await import('../services/dailyPlan.js');
  assert.equal(capScore(9.4, 'Mechanical Engineer'), 4);
  assert.equal(capScore(7, 'Survey Specialist I - Corpus Christi'), 4);
  assert.equal(capScore(8, 'Software Engineer 1 with Security Clearance'), 3);
  assert.equal(capScore(9.4, 'Mechanical Data Analyst – Python'), 9.4);
  assert.equal(capScore(9.1, 'Embedded Software Engineer'), 9.1);
  assert.equal(capScore(2, 'Mechanical Engineer'), 2);
});

test('locations: a wrong state is put right, and real places are left alone', async () => {
  const { fixLocation } = await import('../services/locations.js');
  assert.equal(fixLocation('Poughkeepsie, AR', 'Entry Level'), 'Poughkeepsie, NY');
  assert.equal(fixLocation('Santa Clara, TX'), 'Santa Clara, CA');
  assert.equal(fixLocation('Dayton, MN', 'Engineer - Dayton, OH - 2027'), 'Dayton, OH');
  assert.equal(fixLocation('Arlington, TX'), 'Arlington, TX');
  assert.equal(fixLocation('Remote'), 'Remote');
  assert.equal(fixLocation(null), null);
});

test('outreach check: the rules that stop an approve', async () => {
  const { NOTE_END, closedNote, isCompanyPage, templateAsk } = await import('../services/referralFlow.js');
  const good = { email_body: 'Dear Ana,', linkedin_note: `Hello Ana. ${NOTE_END}`, name: 'Ana Lee', company: 'IBM' };
  assert.deepEqual(checkOutreach(good), []);
  assert.match(checkOutreach({ ...good, email_body: 'Cut latency to 83ns.' })[0], /83ns/);
  assert.deepEqual(checkOutreach({ ...good, email_body: 'Cut latency to 83ns.', quant: true }), []);
  assert.match(checkOutreach({ ...good, linkedin_note: 'Hello Ana.' })[0], /doesn't end/);
  assert.match(checkOutreach({ ...good, name: 'Eye Appoint', company: 'EyeAppoint' })[0], /company page/);
  assert.match(checkOutreach({ ...good, linkedin_note: `${'a'.repeat(300)} ${NOTE_END}` })[0], /characters/);
  assert.ok(isCompanyPage('Eye Appoint', 'EyeAppoint') && !isCompanyPage('Ana Lee', 'IBM'));
  const long = closedNote(`${'a'.repeat(200)}. ${'b'.repeat(200)}`);
  assert.ok(long.length <= 300 && long.endsWith(NOTE_END));
  const t = templateAsk({ personName: 'Eye Appoint', me: 'Sam', title: 'SWE', company: 'EyeAppoint', jobUrl: '' });
  assert.ok(t.body.startsWith('Dear Hiring Team,') && t.note.startsWith('Hello,') && t.note.endsWith(NOTE_END));
});

test('sponsorship: citizen-only wording is caught, and equal-opportunity lines are not', async () => {
  const { classifySponsorship } = await import('../services/sponsorship.js');
  const status = (t) => classifySponsorship(t).status;
  for (const t of [
    'To conform to U.S. Government export regulations, applicant must be a (i) U.S. citizen or national, (ii) U.S. lawful, permanent resident.',
    'We’ll also need you to: Be a US Citizen with no dual citizenship.',
    'This role requires permanent authorization to work in the U.S. (i.e. U.S. citizen or permanent resident).',
    'All applicants must be able to obtain/maintain an active Secret U.S. Security Clearance.',
    'U.S. citizenship. Ability to obtain a clearance.',
    'As such, US person status is required.',
  ]) assert.equal(status(t), 'citizens_only', t);
  for (const t of [
    'Without regard to race, religion, color, national origin, citizenship, sex or age.',
    'regardless of age, color, national origin, citizenship status, disability.',
    'skills, experience, security clearances, licensure and certifications.',
    'U.S. Citizenship may be required for certain positions.',
    'Preferred: US Citizenship',
    'Secret clearance is preferred.',
    'Employment is contingent on either verifying the U.S. Person status or obtaining any necessary export license.',
  ]) assert.equal(status(t), null, t);
});
