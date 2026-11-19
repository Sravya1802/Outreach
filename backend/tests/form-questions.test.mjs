import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/test';
process.env.TOKEN_ENC_KEY ||= 'a'.repeat(64);
const { parseBoard, isProfileQuestion, planAnswers, leverQuestions } = await import('../services/formQuestions.js');
const { samePosting } = await import('../services/readyToSubmit.js');
const { signExtKey, verifyExtKey, signFillToken } = await import('../services/secretBox.js');

test('which board a form is on', () => {
  assert.deepEqual(parseBoard('https://jobs.ashbyhq.com/netic/f291394a/application'), { board: 'ashby', org: 'netic', id: 'f291394a' });
  assert.deepEqual(parseBoard('https://job-boards.greenhouse.io/verkada/jobs/5210813007'), { board: 'greenhouse', org: 'verkada', id: '5210813007' });
  assert.deepEqual(parseBoard('https://boards.greenhouse.io/embed/job_app?for=yext&token=8296161'), { board: 'greenhouse', org: 'yext', id: '8296161' });
  assert.equal(parseBoard('https://grnh.se/whd76nsp1us').board, 'greenhouse-short');
  assert.deepEqual(parseBoard('https://jobs.lever.co/glsllc/d81bfc16/apply'), { board: 'lever', org: 'glsllc', id: 'd81bfc16' });
  assert.equal(parseBoard('https://freddiemac.wd5.myworkdayjobs.com/en-US/external/job/x').board, 'workday');
  assert.equal(parseBoard('https://example.com/jobs/1'), null);
});

test('profile questions are left to the filler; long sponsorship questions too', () => {
  for (const q of ['First Name', 'Email', 'Phone Number', 'LinkedIn Profile', 'What is your GPA?', 'When do you graduate?', 'Location']) assert.ok(isProfileQuestion(q), q);
  assert.ok(isProfileQuestion('Will you now or in the future require immigration sponsorship by our company to commence or continue employment in the United States with our company?'));
  assert.ok(isProfileQuestion('Cover Letter', 'file'));
  for (const q of ['When can you start a new role?', 'How many years of industry experience do you have?', "What's the most interesting paper you've read?", 'Current company']) assert.ok(!isProfileQuestion(q), q);
});

test('each question gets the profile, a saved answer, an earlier answer, or Claude', () => {
  const saved = [{ id: 1, question: 'How did you hear about us?', question_key: 'how did you hear about us', answer: 'Company website', status: 'answered' }];
  const existing = new Map([
    ['what s the most interesting paper you ve read', { source: 'claude', status: 'ready', answer: 'The Raft paper.' }],
    ['what is your target compensation', { status: 'needs_you', note: 'Salary is hers to say' }],
  ]);
  const plan = planAnswers([
    { question: 'Email', type: 'text', required: true },
    { question: 'How did you hear about us?', type: 'text' },
    { question: "What's the most interesting paper you've read?", type: 'long_text', required: true },
    { question: 'What is your target compensation?', type: 'text' },
    { question: 'When can you start a new role?', type: 'date', required: true },
    { question: 'Hidden', type: 'hidden' },
  ], saved, existing);
  assert.deepEqual(plan.map(p => [p.status, p.source, p.answer]), [
    ['profile', 'profile', null], ['ready', 'saved', 'Company website'], ['ready', 'claude', 'The Raft paper.'],
    ['needs_you', null, null], ['writing', null, null],
  ]);
});

test('Lever questions from the apply page, stopping at the EEO section', () => {
  const html = `<ul><li class="application-question"><div class="application-label">Full name<span>✱</span></div><input name="name" type="text"></li>
    <li class="application-question custom-question"><div class="application-label"><div class="text">Do you have relatives at GLS?</div></div>
      <ul><li><label><input type="radio" value="Yes">Yes</label></li><li><label><input type="radio" value="No">No</label></li></ul></li>
    <li class="application-question"><div class="application-label">Target compensation</div><input type="text"></li></ul>
    <div class="section eeo"><select><option>Male</option><option>Female</option></select></div>`;
  const qs = leverQuestions(html);
  assert.deepEqual(qs.map(q => [q.question, q.type, q.options, q.required]), [
    ['Full name', 'text', [], true], ['Do you have relatives at GLS?', 'radio', ['Yes', 'No'], false], ['Target compensation', 'text', [], false],
  ]);
});

test('the same posting, however it was linked', () => {
  assert.ok(samePosting('https://jobs.ashbyhq.com/netic/f291/application', 'https://jobs.ashbyhq.com/netic/f291'));
  assert.ok(samePosting('https://job-boards.greenhouse.io/embed/job_app?for=yext&token=8296161', 'https://job-boards.greenhouse.io/yext/jobs/8296161'));
  assert.ok(samePosting('https://www.yext.com/careers/open-positions?gh_jid=8296161', 'https://job-boards.greenhouse.io/yext/jobs/8296161'));
  assert.ok(samePosting('https://jobs.lever.co/glsllc/d81b/apply?lever-source=x', 'https://jobs.lever.co/glsllc/d81b'));
  assert.ok(!samePosting('https://jobs.ashbyhq.com/netic/f291', 'https://jobs.ashbyhq.com/netic/9999'));
  assert.ok(!samePosting('not a url', 'https://jobs.ashbyhq.com/netic/f291'));
});

test('the extension key: one user, expires, and isn’t a fill link', () => {
  const k = signExtKey('user-1', { now: 1000 });
  assert.equal(verifyExtKey(k, { now: 2000 }), 'user-1');
  assert.equal(verifyExtKey(k, { now: 1000 + 121 * 24 * 3600_000 }), null);
  assert.equal(verifyExtKey(`${k.split('.')[0]}.bad`), null);
  assert.equal(verifyExtKey(signFillToken('user-1', 5)), null);
});
