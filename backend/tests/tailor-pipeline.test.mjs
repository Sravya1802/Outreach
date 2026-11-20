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

test('the app writes no resumes and no emails: the outreach writers are gone', async () => {
  const { start } = await import('../services/resumeEngine.js');
  const { draftPicked } = await import('../services/dailyPlan.js');
  await assert.rejects(start('u', 1, 'resume'), /no longer writes resumes/);
  assert.equal(await draftPicked('u'), 0);
  const flow = await import('../services/referralFlow.js');
  for (const name of ['templateAsk', 'draftAsk', 'askForReferral', 'addMissingNotes', 'companyDetail', 'placePhrase']) assert.equal(flow[name], undefined, name);
  const pipe = await import('../services/tailorPipeline.js');
  for (const name of ['templateOutreach', 'retryBlankDrafts']) assert.equal(pipe[name], undefined, name);
  const ai = await import('../services/ai.js');
  for (const name of ['generateOutreach', 'generateWaaSMessage', 'generateOutreachTemplate']) assert.equal(ai[name], undefined, name);
  const msgs = await import('../services/messages.js');
  for (const name of ['templateMessages', 'writeFor', 'writeAll']) assert.equal(msgs[name], undefined, name);
  const ob = await import('../services/outbox.js');
  for (const name of ['followupBody', 'scheduleThreadNote']) assert.equal(ob[name], undefined, name);
});

test('stillWriting: an empty email for someone with an address, or an empty note, is still being written', async () => {
  const { stillWriting } = await import('../services/tailorPipeline.js');
  const done = { email: 'ana@x.com', email_status: 'valid', email_body: 'Dear Ana,', linkedin_note: 'Hello Ana.' };
  assert.equal(stillWriting(done), false);
  assert.equal(stillWriting({ ...done, email_body: null }), true);
  assert.equal(stillWriting({ ...done, email_body: '  ' }), true);
  assert.equal(stillWriting({ ...done, linkedin_note: null }), true);
  assert.equal(stillWriting({ ...done, email: null, email_body: null }), false);
  assert.equal(stillWriting({ ...done, email_status: 'invalid', email_body: null }), false);
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
  const { NOTE_END, isCompanyPage } = await import('../services/referralFlow.js');
  const good = { email_body: 'Dear Ana,', linkedin_note: `Hello Ana. ${NOTE_END}`, name: 'Ana Lee', company: 'IBM' };
  assert.deepEqual(checkOutreach(good), []);
  assert.match(checkOutreach({ ...good, email_body: 'Cut latency to 83ns.' })[0], /83ns/);
  assert.deepEqual(checkOutreach({ ...good, email_body: 'Cut latency to 83ns.', quant: true }), []);
  assert.match(checkOutreach({ ...good, linkedin_note: 'Hello Ana.' })[0], /doesn't end/);
  assert.match(checkOutreach({ ...good, name: 'Eye Appoint', company: 'EyeAppoint' })[0], /company page/);
  assert.match(checkOutreach({ ...good, linkedin_note: `${'a'.repeat(300)} ${NOTE_END}` })[0], /characters/);
  assert.ok(isCompanyPage('Eye Appoint', 'EyeAppoint') && !isCompanyPage('Ana Lee', 'IBM'));
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

test('Apollo people search: rows with an id and a first name, masked last names left for the match', async () => {
  const { readApolloPeople } = await import('../services/emailProviders.js');
  const rows = readApolloPeople({ people: [
    { id: 'a1', first_name: 'Tara', last_name_obfuscated: 'Bo***e', title: 'University Recruiter', has_email: true },
    { id: 'a2', first_name: 'Sam', title: 'Technical Recruiter', has_email: false },
    { id: null, first_name: 'Nobody', title: 'Recruiter' },
    { id: 'a4', first_name: '', title: 'Recruiter' },
  ] });
  assert.deepEqual(rows, [
    { id: 'a1', first: 'Tara', title: 'University Recruiter', hasEmail: true },
    { id: 'a2', first: 'Sam', title: 'Technical Recruiter', hasEmail: false },
  ]);
  assert.deepEqual(readApolloPeople(null), []);
  assert.deepEqual(readApolloPeople({ people: 'x' }), []);
});

test('keywordCheck: combined keywords are separate terms; C++ and C# match literally', () => {
  const table = [{ keyword: 'C++, Python' }, { keyword: 'Go; Rust' }, { keyword: 'C' }, { keyword: 'CI/CD' }, { keyword: 'SQL, NoSQL, etc.' }]
  const r = keywordCheck('Languages: C++ and Python. Built CI/CD with Go. SQL daily.', table)
  assert.deepEqual(r.present.sort(), ['C++', 'CI/CD', 'Go', 'Python', 'SQL'].sort())
  assert.deepEqual(r.missing.sort(), ['C', 'NoSQL', 'Rust'].sort())
  assert.deepEqual(keywordCheck('I write C and C#.', [{ keyword: 'C++' }]).missing, ['C++'])
  assert.deepEqual(keywordCheck('Python, C++', [{ keyword: 'C++' }]).present, ['C++'])
})

test('planOutreach: one person, one row per company, on the best-fit role; the other roles go in also', async () => {
  const { planOutreach } = await import('../services/tailorPipeline.js');
  const roles = [
    { id: 1, callback_after: 30, ats_after: 92 },
    { id: 2, callback_after: 45, ats_after: 91 },
    { id: 3, callback_after: 45, ats_after: 95 },
  ];
  const ana = { id: 10, audience: 'recruiter' };
  const bo = { id: 11, audience: 'recruiter' };
  const cy = { id: 12, audience: 'engineer' };
  const targets = new Map([['1', [ana, bo]], ['2', [ana, bo]], ['3', [ana, bo, cy]]]);
  const plan = planOutreach({ roles, targets });
  // Role 3 fits best (same callback as 2, higher ATS): Ana and Bo go there, with 2 and 1 noted.
  assert.deepEqual(plan.insert, [
    { planItemId: '3', contactId: '10', audience: 'recruiter', also: ['2', '1'] },
    { planItemId: '3', contactId: '11', audience: 'recruiter', also: ['2', '1'] },
    { planItemId: '3', contactId: '12', audience: 'engineer', also: [] },
  ]);
  assert.deepEqual(plan.append, []);
  assert.deepEqual(plan.skip, []);
});

test('planOutreach: someone already asked for another role stays there', async () => {
  const { planOutreach } = await import('../services/tailorPipeline.js');
  const roles = [{ id: 1, score: 8 }, { id: 2, score: 9 }];
  const targets = new Map([['1', [{ id: 10 }, { id: 11 }]], ['2', [{ id: 10 }, { id: 11 }]]]);
  const existing = new Map([
    ['10', { draftId: 500, planItemId: 99, unwritten: true }],   // empty row elsewhere: these roles join it
    ['11', { draftId: 501, planItemId: 98, unwritten: false }],  // written elsewhere: left alone
  ]);
  const plan = planOutreach({ roles, targets, existing });
  assert.deepEqual(plan.insert, []);
  assert.deepEqual(plan.append, [{ draftId: '500', add: ['2', '1'] }]);
  assert.deepEqual(plan.skip, [{ contactId: '11', planItemId: '98', roles: ['2', '1'] }]);
});

test('byFit: callback, then ATS, then score; unknowns last', async () => {
  const { byFit } = await import('../services/tailorPipeline.js');
  const list = [{ id: 1 }, { id: 2, score: 9 }, { id: 3, ats_after: 93 }, { id: 4, callback_after: 20 }];
  assert.deepEqual(list.sort(byFit).map(r => r.id), [4, 3, 2, 1]);
});

test('planMerge: one email per person per company, on the best-fit role, the rest closed', async () => {
  const { planMerge } = await import('../services/tailorPipeline.js');
  const roles = new Map([
    ['1', { id: '1', title: 'SWE Intern', callback_after: 30 }],
    ['2', { id: '2', title: 'Data Intern', callback_after: 50 }],
    ['3', { id: '3', title: 'ML Intern', callback_after: 40 }],
    ['4', { id: '4', title: 'SWE New Grad', callback_after: 60 }],
  ]);
  // Rows on 1, 2 and 3; role 4 (no rows of its own) would reach them too and fits best.
  const p = planMerge({ rows: [{ id: 11, planItemId: '1' }, { id: 12, planItemId: '2' }, { id: 13, planItemId: '3' }], extra: ['4'], roles });
  assert.deepEqual(p.keep, { planItemId: '4', draftId: null, also: ['2', '3', '1'] });
  assert.deepEqual(p.close.map(c => c.draftId), ['11', '12', '13']);
  assert.match(p.close[0].reason, /Merged into the email for SWE New Grad/);
  // Without role 4, the row on the best-fit role stays (its text is cleared on apply).
  const q = planMerge({ rows: [{ id: 11, planItemId: '1' }, { id: 12, planItemId: '2' }], roles });
  assert.deepEqual(q.keep, { planItemId: '2', draftId: '12', also: ['1'] });
  assert.deepEqual(q.close.map(c => c.draftId), ['11']);
  // One role and nothing to add: untouched (its written email stays).
  assert.deepEqual(planMerge({ rows: [{ id: 11, planItemId: '1' }], roles }), { keep: null, close: [] });
  // Already asked in an approved email there: every unsent copy closes.
  const r = planMerge({ rows: [{ id: 11, planItemId: '1' }], extra: ['4'], approvedOn: '9', roles: new Map([...roles, ['9', { title: 'Platform Intern' }]]) });
  assert.equal(r.keep, null);
  assert.match(r.close[0].reason, /Already asked in the approved email for Platform Intern/);
});

test('review queue order: waiting roles with a posting are numbered by priority then newest posting; the rest by last change', async () => {
  const { orderQueue } = await import('../services/tailorPipeline.js');
  const rows = [
    { id: '1', status: 'ready', updated_at: '2026-11-18T10:00:00Z', _jid: 1 },
    { id: '2', status: 'queued', no_posting: false, _priority: 0, _order_at: '2026-11-10T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', _jid: 2 },
    { id: '3', status: 'queued', no_posting: false, _priority: 5, _order_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', _jid: 3 },
    { id: '4', status: 'queued', no_posting: true, _priority: 9, _order_at: '2026-11-15T00:00:00Z', updated_at: '2026-11-19T00:00:00Z', _jid: 4 },
    { id: '5', status: 'queued', no_posting: false, _priority: 0, _order_at: '2026-11-12T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', _jid: 5 },
    { id: '6', status: 'closed', updated_at: '2026-11-18T10:00:00Z', _jid: 6 },
  ];
  const out = orderQueue(rows);
  assert.deepEqual(out.map(r => [r.id, r.place]), [['3', 1], ['5', 2], ['2', 3], ['4', null], ['6', null], ['1', null]]);
});
