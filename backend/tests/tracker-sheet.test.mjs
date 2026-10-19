import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, sheetRows, toApplyStatus, toReferral, toCsv, matchKey, referralFromPlan } from '../services/trackerSheet.js';

// The shape of the user's own sheet: a title banner, then the header row.
const SHEET = [
  ',,,,,,',
  ',2027 NEW GRAD ROLES APPLICATION,,,,,',
  ',Companies,Roles,Link,Submitted,Application Status,Refferal Status',
  ',Optiver,Graduate Software Engineer - 2027 Start,https://www.optiver.com/join-us/jobs/8401042002/?gh_jid=8401042002,Yes,Rejected,Yes',
  ',IMC Trading,Software Engineer Full-Time: New Grad,,Yes,Rejected,Yes',
  ',Jane street,Software Engineer Full-Time: New Grad,https://www.janestreet.com/join-jane-street/position/8594541002,Yes,Rejected,Not Required',
  ',Akuna Capital,Software Engineer - Entry-Level - C++,https://www.akunacapital.com/careers/job/8013085/?gh_jid=8013085,Yes,In Progress,Yes',
  ',Five Rings,Campus Full Time 2027 - Software Developer,https://job-boards.greenhouse.io/fiveringsllc/jobs/5349839008,Yes,Waiting to hear back,No',
  ',Robolox,2027 Software Engineer - Early Career,https://careers.roblox.com/jobs/8072244?gh_jid=8072244,,,',
  ',"Fidelity\'s Leap Program","July 2027 - Leap Software Engineer, ""TX""",f,,,',
  ',,,,,,',
].join('\r\n');

test('CSV: quotes, escaped quotes, commas and CRLF', () => {
  assert.deepEqual(parseCsv('a,"b, c","d ""e"""\r\n1,2,3'), [['a', 'b, c', 'd "e"'], ['1', '2', '3']]);
  assert.deepEqual(parseCsv('"multi\nline",x'), [['multi\nline', 'x']]);
});

test('the user’s sheet: header found under the banner, rows read, junk links dropped', () => {
  const { rows, error } = sheetRows(SHEET);
  assert.equal(error, null);
  assert.equal(rows.length, 7);
  assert.equal(sheetRows(SHEET).title, '2027 NEW GRAD ROLES APPLICATION');
  assert.deepEqual(rows[0], { company: 'Optiver', role: 'Graduate Software Engineer - 2027 Start', link: 'https://www.optiver.com/join-us/jobs/8401042002/?gh_jid=8401042002', submitted: 'Yes', status: 'Rejected', referral: 'Yes' });
  assert.equal(rows[6].role, 'July 2027 - Leap Software Engineer, "TX"');
  assert.equal(rows[6].link, ''); // "f" isn't a link
  assert.match(sheetRows('a,b\n1,2').error, /header row/);
});

test('sheet words → statuses', () => {
  assert.equal(toApplyStatus('Yes', 'Rejected'), 'rejected');
  assert.equal(toApplyStatus('Yes', 'Waiting to hear back'), 'submitted');
  assert.equal(toApplyStatus('Yes', 'Waiting to her back'), 'submitted'); // the sheet's own typo
  assert.equal(toApplyStatus('Yes', 'In Progress'), 'responded');
  assert.equal(toApplyStatus('Yes', 'Interview'), 'interview');
  assert.equal(toApplyStatus('Yes', 'Offer'), 'offer');
  assert.equal(toApplyStatus('Yes', ''), 'submitted');
  assert.equal(toApplyStatus('', ''), 'not_started');
  assert.equal(toReferral('Yes'), 'yes');
  assert.equal(toReferral('No'), 'no');
  assert.equal(toReferral('Not Required'), 'not_required');
  assert.equal(toReferral(''), null);
  assert.equal(referralFromPlan('submitted'), 'yes');
  assert.equal(referralFromPlan('none'), null);
});

test('download round-trips through the import', () => {
  const csv = toCsv([
    { company_name: 'Optiver', job_title: 'Graduate SWE, 2027', job_url: 'https://x.com/1', apply_status: 'rejected', referral: 'yes' },
    { company_name: 'Stripe', job_title: 'SWE New Grad', job_url: null, apply_status: 'not_started', referral: null },
  ]);
  const { rows } = sheetRows(csv);
  assert.deepEqual(rows.map(r => [r.company, r.role, toApplyStatus(r.submitted, r.status), toReferral(r.referral)]), [
    ['Optiver', 'Graduate SWE, 2027', 'rejected', 'yes'],
    ['Stripe', 'SWE New Grad', 'not_started', null],
  ]);
});

test('match keys: same posting with tracking bits, or same company and role', () => {
  assert.equal(matchKey({ link: 'https://www.optiver.com/join-us/jobs/8401042002/?gh_jid=8401042002&utm_source=x' }), matchKey({ link: 'https://optiver.com/join-us/jobs/8401042002?gh_jid=8401042002' }));
  assert.notEqual(matchKey({ link: 'https://careers.roblox.com/jobs?gh_jid=1' }), matchKey({ link: 'https://careers.roblox.com/jobs?gh_jid=2' }));
  assert.equal(matchKey({ company: 'Jane Street', role: 'SWE: New Grad' }), matchKey({ company: 'jane street', role: 'SWE New Grad' }));
});
