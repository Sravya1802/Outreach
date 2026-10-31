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
    'Your emails to Ana and Bo are waiting for your OK in People → Contacts. Applying Thu unless a referral comes first.');
  assert.equal(referralNote([{ channel: 'email', person_name: 'Ana', status: 'draft' }, { channel: 'email', person_name: 'Bo', status: 'scheduled' }], 'Fri'),
    'Your email to Ana is waiting for your OK in People → Contacts; emailing Bo at their next morning. Applying Fri unless a referral comes first.');
  // A note that goes with an email is mentioned once, not listed as its own ask.
  assert.equal(referralNote([
    { channel: 'email', person_name: 'Ana', status: 'draft' }, { channel: 'linkedin', person_name: 'Ana', status: 'to_send' },
    { channel: 'email', person_name: 'Bo', status: 'draft' }, { channel: 'linkedin', person_name: 'bo', status: 'to_send' },
    { channel: 'linkedin', person_name: 'Cy', status: 'to_send' },
  ], 'Thu'), 'Your emails to Ana and Bo are waiting for your OK in People → Contacts; send the matching LinkedIn notes from there too; notes for Cy are ready for you to send on LinkedIn. Applying Thu unless a referral comes first.');
  assert.equal(referralNote([
    { channel: 'email', person_name: 'Ana', status: 'scheduled' }, { channel: 'linkedin', person_name: 'Ana', status: 'marked_sent' },
  ], 'Fri'), 'Emailing Ana at their next morning. Applying Fri unless a referral comes first.');
  const t = templateAsk({ personName: 'Ana Lee', me: 'Sravya R', school: 'UIC', title: 'SWE Intern', company: 'Ramp', jobUrl: 'https://x', why: '' });
  assert.ok(t.note.length <= 300 && t.note.startsWith('Hello Ana,'));
  assert.ok(t.body.startsWith('Dear Ana,\n\n'));
  assert.match(t.body, /The job posting is available here: https:\/\/x/);
  assert.match(t.body, /I would be glad to send my résumé/);
  assert.match(t.body, /consideration\.\n\nBest regards,\nSravya R$/);
  assert.doesNotMatch(t.body + t.note, /\b(I'm|I'd|Hi)\b|!/);
  assert.match(templateAsk({ personName: 'Ana', title: 'SWE Intern', company: 'Ramp', jobUrl: 'https://x', attached: true }).body, /attached my résumé for your reference\. The job posting/);
  assert.ok(templateAsk({ personName: '', me: 'S', title: 'SWE', company: 'Ramp', jobUrl: 'https://x' }).note.startsWith('Hello, I am S'));
  assert.match(linkedinSearchUrl('Ramp', 'UIC'), /keywords=Ramp%20UIC/);
});

test('referral email: public job link, grammatical school name, our own signature', async () => {
  const { postingUrl, schoolName, signature, signed, templateAsk } = await import('../services/referralFlow.js');
  assert.equal(postingUrl('https://job-boards.greenhouse.io/embed/job_app?for=dominodatalab&token=7992556'), 'https://job-boards.greenhouse.io/dominodatalab/jobs/7992556');
  assert.equal(postingUrl('https://boards.greenhouse.io/embed/job_app?for=acme&token=12'), 'https://job-boards.greenhouse.io/acme/jobs/12');
  assert.equal(postingUrl('https://jobs.lever.co/x/1'), 'https://jobs.lever.co/x/1');
  assert.equal(postingUrl('not a url'), 'not a url');
  assert.equal(schoolName('University of Illinois at Chicago'), 'the University of Illinois at Chicago');
  assert.equal(schoolName('UIC'), 'UIC');
  const who = { name: 'Lakshmi Sravya Rachakonda', degree: 'B.S.', major: 'Computer Science', school: 'University of Illinois at Chicago', linkedin: 'https://linkedin.com/in/x' };
  assert.equal(signature(who), 'Best regards,\nLakshmi Sravya Rachakonda\nB.S. in Computer Science, University of Illinois at Chicago\nhttps://linkedin.com/in/x');
  assert.equal(signature({ name: 'A', major: 'Math' }), 'Best regards,\nA\nMath');
  // A sign-off the model adds anyway is replaced, not doubled.
  assert.equal(signed('Dear A,\n\nBody.\n\nThank you,\nLakshmi Sravya Rachakonda\n', who.name, 'Best regards,\nX'), 'Dear A,\n\nBody.\n\nBest regards,\nX');
  assert.equal(signed('Dear A,\n\nThank you for your time and consideration.', 'N', 'SIG'), 'Dear A,\n\nThank you for your time and consideration.\n\nSIG');
  assert.equal(signed('Here: https://x.io/jobs/7.\n\nThanks.', 'N', 'S'), 'Here: https://x.io/jobs/7\n\nThanks.\n\nS');
  assert.equal(signed('See https://x.io/7. Then more.', 'N', 'S'), 'See https://x.io/7. Then more.\n\nS');
  const { noteFit } = await import('../services/referralFlow.js');
  assert.equal(noteFit('Short.'), 'Short.');
  assert.equal(noteFit(`${'a'.repeat(200)}. Would you refer me? ${'b'.repeat(120)}`), `${'a'.repeat(200)}. Would you refer me?`);
  const t = templateAsk({ personName: 'Murat K', me: who.name, school: who.school, major: who.major, sig: signature(who), title: 'Forward Deployed Engineer', company: 'Domino Data Lab', jobUrl: 'https://job-boards.greenhouse.io/embed/job_app?for=dominodatalab&token=7992556', attached: true, why: 'Strong match on Python and SQL' });
  assert.match(t.body, /a Computer Science student at the University of Illinois at Chicago/);
  assert.doesNotMatch(t.body, /Strong match/); // the match note is for the user, not the recipient
  assert.match(t.body, /available here: https:\/\/job-boards\.greenhouse\.io\/dominodatalab\/jobs\/7992556/);
  assert.equal(t.subject, 'Referral request: Forward Deployed Engineer at Domino Data Lab');
});

test('message template: referral when there is a role, a short chat otherwise', async () => {
  const { templateMessages } = await import('../services/messages.js');
  const withRole = templateMessages({ personName: 'Ana Lee', me: 'Sravya R', school: 'UIC', company: 'Ramp', role: { title: 'SWE Intern', url: 'https://jobs.ashbyhq.com/ramp/1' }, isConnection: true });
  assert.ok(withRole.note.startsWith('Hello Ana,') && withRole.note.length <= 300);
  assert.match(withRole.note, /SWE Intern position/);
  assert.ok(withRole.body.startsWith('Dear Ana,'));
  assert.match(withRole.body, /we are connected on LinkedIn/);
  assert.match(withRole.body, /The job posting is available here: https:\/\/jobs\.ashbyhq\.com\/ramp\/1/);
  assert.match(withRole.body, /Best regards,\nSravya R$/);
  assert.doesNotMatch(withRole.body + withRole.note, /\b(I'm|I'd|Hi)\b|’re|!/);
  const noRole = templateMessages({ personName: 'Bo', me: '', school: '', company: 'Stripe', role: null, isConnection: false });
  assert.match(noRole.note, /how you joined Stripe/);
  assert.equal(noRole.subject, 'Question about Stripe');
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
  const t = pickTargets(pool, { maxEmails: 2 });
  assert.deepEqual(t.email.map(p => p.name), ['Rec', 'Eng2']);
  // Default: up to 20 emails a role, everyone with an address (leaders last).
  assert.deepEqual(pickTargets(pool).email.map(p => p.name), ['Rec', 'Eng2', 'VP']);
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

test('referral targets: a found address beats a guessed one in the same rank', async () => {
  const { pickTargets } = await import('../services/referralFlow.js');
  const pool = [
    { name: 'Guess', title: 'Software Engineer', email: 'guess@x.com', guessed: true },
    { name: 'Found', title: 'Software Engineer', email: 'found@x.com' },
    { name: 'RecGuess', title: 'Recruiter', email: 'rec@x.com', guessed: true },
  ];
  assert.deepEqual(pickTargets(pool, { maxEmails: 2 }).email.map(p => p.name), ['RecGuess', 'Found']);
});

test('referral note: a long list names two people and counts the rest', async () => {
  const { referralNote } = await import('../services/referralFlow.js');
  const asks = ['Ana', 'Bo', 'Cy', 'Di', 'Ed'].map(n => ({ channel: 'email', person_name: n, status: 'draft' }));
  assert.equal(referralNote(asks, 'Fri'), 'Your emails to Ana, Bo and 3 others are waiting for your OK in People → Contacts. Applying Fri unless a referral comes first.');
});
