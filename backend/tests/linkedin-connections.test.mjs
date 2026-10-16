import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgres://x:y@127.0.0.1:1/z';
const { companyKey, parseCsv, parseConnections } = await import('../services/linkedinConnections.js');

test('company names match across spellings', () => {
  assert.equal(companyKey('Ramp'), 'ramp');
  assert.equal(companyKey('Stripe, Inc.'), 'stripe');
  assert.equal(companyKey('Databricks Inc'), 'databricks');
  assert.equal(companyKey('Johnson & Johnson'), 'johnson and johnson');
  assert.equal(companyKey('Nestlé S.A.'), companyKey('Nestle'));
  assert.notEqual(companyKey('Ramp'), companyKey('WorkRamp'));
  assert.equal(companyKey('Garmin International'), 'garmin');
  assert.equal(companyKey('Siemens USA'), 'siemens');
  assert.notEqual(companyKey('Ramp Network'), companyKey('Ramp'));
});

test('CSV with quotes, commas and newlines', () => {
  assert.deepEqual(parseCsv('a,"b, c","say ""hi"""\n1,"x\ny",3'), [['a', 'b, c', 'say "hi"'], ['1', 'x\ny', '3']]);
});

test('LinkedIn export with its notes preamble', () => {
  const csv = '﻿Notes:\n"When exporting your connection data, you may notice that some of the email addresses are missing."\n\nFirst Name,Last Name,URL,Email Address,Company,Position,Connected On\nAna,Lee,https://www.linkedin.com/in/analee,,"Ramp","Software Engineer",14 Oct 2026\nBo,,https://www.linkedin.com/in/bo,bo@x.com,Stripe,Recruiter,01 Jan 2025\n,,,,,,\n';
  const people = parseConnections(csv);
  assert.equal(people.length, 2);
  assert.deepEqual(people[0], { first: 'Ana', last: 'Lee', full: 'Ana Lee', url: 'https://www.linkedin.com/in/analee', email: null, company: 'Ramp', position: 'Software Engineer', connectedOn: '2026-10-14' });
  assert.equal(people[1].full, 'Bo');
  assert.throws(() => parseConnections('name,age\nx,1'), /Connections\.csv/);
});

test('referral status line', async () => {
  const { referralNote, templateAsk, linkedinSearchUrl } = await import('../services/referralFlow.js');
  assert.equal(referralNote([{ channel: 'linkedin', person_name: 'Riya' }, { channel: 'linkedin', person_name: 'Jordan' }], 'Mon 9 AM'),
    'Notes for Riya and Jordan are ready for you to send on LinkedIn. Applying Mon 9 AM unless a referral comes first.');
  assert.equal(referralNote([{ channel: 'email', person_name: 'Ana' }, { channel: 'linkedin', person_name: 'Bo' }], 'Tue'),
    'Emailing Ana at their next morning; notes for Bo are ready for you to send on LinkedIn. Applying Tue unless a referral comes first.');
  assert.match(referralNote([{ channel: 'search' }], 'Wed'), /^Nobody you know there yet/);
  assert.equal(referralNote([{ channel: 'email', person_name: 'Ana', status: 'draft' }, { channel: 'email', person_name: 'Bo', status: 'draft' }], 'Thu'),
    'Your emails to Ana and Bo are waiting for your OK in People → Outbox. Applying Thu unless a referral comes first.');
  assert.equal(referralNote([{ channel: 'email', person_name: 'Ana', status: 'draft' }, { channel: 'email', person_name: 'Bo', status: 'scheduled' }], 'Fri'),
    'Your email to Ana is waiting for your OK in People → Outbox; emailing Bo at their next morning. Applying Fri unless a referral comes first.');
  const t = templateAsk({ personName: 'Ana Lee', me: 'Sravya R', school: 'UIC', title: 'SWE Intern', company: 'Ramp', jobUrl: 'https://x', why: '' });
  assert.ok(t.note.length <= 300 && t.note.startsWith('Hi Ana,'));
  assert.match(t.body, /The posting: https:\/\/x/);
  assert.match(t.body, /I can send my resume/);
  assert.match(templateAsk({ personName: 'Ana', title: 'SWE Intern', company: 'Ramp', jobUrl: 'https://x', attached: true }).body, /My resume is attached\. The posting/);
  assert.match(linkedinSearchUrl('Ramp', 'UIC'), /keywords=Ramp%20UIC/);
});

test('message template: referral when there is a role, a short chat otherwise', async () => {
  const { templateMessages } = await import('../services/messages.js');
  const withRole = templateMessages({ personName: 'Ana Lee', me: 'Sravya R', school: 'UIC', company: 'Ramp', role: { title: 'SWE Intern', url: 'https://jobs.ashbyhq.com/ramp/1' }, isConnection: true });
  assert.ok(withRole.note.startsWith('Hi Ana,') && withRole.note.length <= 300);
  assert.match(withRole.note, /SWE Intern role/);
  assert.match(withRole.body, /we’re connected on LinkedIn/);
  assert.match(withRole.body, /The posting: https:\/\/jobs\.ashbyhq\.com\/ramp\/1/);
  const noRole = templateMessages({ personName: 'Bo', me: '', school: '', company: 'Stripe', role: null, isConnection: false });
  assert.match(noRole.note, /how you got into Stripe/);
  assert.equal(noRole.subject, 'Quick question about Stripe');
});

test('referral targets: emails and LinkedIn notes go to different people, best first', async () => {
  const { pickTargets } = await import('../services/referralFlow.js');
  const li = (n) => `https://www.linkedin.com/in/${n}`;
  const pool = [
    { name: 'VP', title: 'VP Engineering', email: 'vp@x.com', linkedin: li('vp') },
    { name: 'Eng', title: 'Software Engineer', email: null, linkedin: li('eng') },
    { name: 'Rec', title: 'Technical Recruiter', email: 'rec@x.com', linkedin: li('rec') },
    { name: 'Friend', title: 'Product Manager', email: null, linkedin: li('friend'), knows: true },
    { name: 'NoLink', title: 'Software Engineer', email: null, linkedin: null },
    { name: 'Eng2', title: 'Backend Developer', email: 'eng2@x.com', linkedin: 'https://www.linkedin.com/search/results/people/?keywords=x' },
  ];
  const t = pickTargets(pool);
  assert.deepEqual(t.email.map(p => p.name), ['Rec', 'Eng2']);
  assert.deepEqual(t.note.map(p => p.name), ['Friend', 'Eng']);
  // No Gmail: nobody is emailed, so the best LinkedIn profiles get notes.
  assert.deepEqual(pickTargets(pool, { canEmail: false }).note.map(p => p.name), ['Friend', 'Rec']);
  assert.deepEqual(pickTargets([]), { email: [], note: [] });
  // The CEO, founders and people who left aren't asked, unless the user knows them.
  const top = [
    { name: 'Ceo', title: 'Co-Founder / CEO', email: 'ceo@x.com', linkedin: li('ceo') },
    { name: 'Ex', title: 'Founder | ex-Plaid engineer', email: null, linkedin: li('ex') },
    { name: 'Pal', title: 'CTO', email: null, linkedin: li('pal'), knows: true },
    { name: 'Swe', title: 'Senior Software Engineer', email: null, linkedin: li('swe') },
  ];
  const t2 = pickTargets(top);
  assert.deepEqual(t2.email.map(p => p.name), []);
  assert.deepEqual(t2.note.map(p => p.name), ['Pal', 'Swe']);
});
