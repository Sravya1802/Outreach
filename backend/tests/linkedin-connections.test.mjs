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
  assert.ok(t.body.startsWith('Dear Ana,\n\nI am applying for the SWE Intern role at Ramp, and I would be grateful if you could review my application'));
  assert.match(t.body, /I would be glad to send my resume, and the posting is here: https:\/\/x\. Thank you/);
  assert.match(t.body, /consideration\.\n\nBest regards,\nSravya R$/);
  assert.doesNotMatch(t.body + t.note, /\b(I'm|I'd|Hi)\b|!|My name is/);
  assert.match(templateAsk({ personName: 'Ana', title: 'SWE Intern', company: 'Ramp', jobUrl: 'https://x', attached: true }).body, /My resume is attached, and the posting is here: https:\/\/x\. Thank you/);
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
  const sig = 'Best regards,\nLakshmi Sravya Rachakonda\nMasters in Computer Science, University of Illinois at Chicago\nhttps://www.linkedin.com/in/sravya-rl/'
  const jd = 'About the role. Domino Data Lab builds the enterprise AI platform that the world’s top companies run on. We offer great benefits.'
  const t = templateAsk({ personName: 'Murat K', me: who.name, school: who.school, major: who.major, sig, title: 'Forward Deployed Engineer', company: 'Domino Data Lab', location: 'New York, NY; Remote', audience: 'engineer', jd, matches: ['Python', 'SQL', 'Kubernetes'], jobUrl: 'https://job-boards.greenhouse.io/embed/job_app?for=dominodatalab&token=7992556', attached: true, why: 'Strong match on Python and SQL' });
  assert.ok(t.body.startsWith('Dear Murat,\n\nI am applying for the Forward Deployed Engineer role at Domino Data Lab in New York, NY, and I would be grateful if you would consider referring me.'))
  assert.doesNotMatch(t.body, /Strong match|My name is/); // the match note is for the user, not the recipient
  assert.match(t.body, /Master of Science in Computer Science at the University of Illinois at Chicago \(May 2027\), after two years as a Software Engineer at Mercedes-Benz Research and Development India/)
  assert.match(t.body, /hands-on work with Python, SQL and Kubernetes, which this role lists/)
  assert.match(t.body, /My resume is attached, and the posting is here: https:\/\/job-boards\.greenhouse\.io\/dominodatalab\/jobs\/7992556\. Thank you for your time and consideration\.\n\nBest regards,\nLakshmi Sravya Rachakonda\nMasters in Computer Science/);
  assert.equal(t.subject, 'Forward Deployed Engineer: Lakshmi Sravya Rachakonda');
});

test('message template: referral when there is a role, a short chat otherwise', async () => {
  const { templateMessages } = await import('../services/messages.js');
  const withRole = templateMessages({ personName: 'Ana Lee', me: 'Sravya R', school: 'UIC', company: 'Ramp', role: { title: 'SWE Intern', url: 'https://jobs.ashbyhq.com/ramp/1' }, isConnection: true });
  assert.ok(withRole.note.startsWith('Hello Ana,') && withRole.note.length <= 300);
  assert.match(withRole.note, /SWE Intern position/);
  assert.ok(withRole.body.startsWith('Dear Ana,\n\nI am applying for the SWE Intern role at Ramp'));
  assert.match(withRole.body, /we are connected on LinkedIn/);
  assert.doesNotMatch(withRole.body, /My name is/);
  assert.match(withRole.body, /the posting is here: https:\/\/jobs\.ashbyhq\.com\/ramp\/1\. Thank you/);
  assert.match(withRole.body, /Best regards,\nSravya R$/);
  assert.doesNotMatch(withRole.body + withRole.note, /\b(I'm|I'd|Hi)\b|’re|!/);
  const noRole = templateMessages({ personName: 'Bo', me: '', school: '', company: 'Stripe', role: null, isConnection: false });
  assert.match(noRole.note, /how you joined Stripe/);
  assert.equal(noRole.subject, 'Question about Stripe');
});

test('referral targets: the best 2 recruiters and nobody else', async () => {
  const { pickTargets } = await import('../services/referralFlow.js');
  const li = (n) => `https://www.linkedin.com/in/${n}`;
  const others = [
    { name: 'VP', title: 'VP Engineering', email: 'vp@x.com', linkedin: li('vp') },
    { name: 'Eng', title: 'Software Engineer', email: 'eng@x.com', linkedin: li('eng') },
    { name: 'Friend', title: 'Product Manager', email: null, linkedin: li('friend'), knows: true },
  ];
  const rec = (name, title, email) => ({ name, title, email, linkedin: li(name) });
  // Early-career recruiters come before the rest, and a company's size changes nothing.
  const many = [...others, rec('Rec', 'Recruiter', 'rec@x.com'), rec('Rec2', 'Talent Acquisition Partner', 'rec2@x.com'), rec('Uni', 'University Recruiter', 'uni@x.com')];
  for (let i = 0; i < 60; i++) many.push(rec(`R${i}`, 'Recruiter', `r${i}@x.com`));
  const t = pickTargets(many);
  assert.deepEqual(t.email.map(p => p.name), ['Uni', 'Rec']);
  assert.deepEqual(t.note, []);
  // A recruiter with no address gets a note, inside the same 2.
  const one = pickTargets([...others, rec('Rec', 'Recruiter', 'rec@x.com'), rec('NoMail', 'Recruiter', null), rec('NoMail2', 'Recruiter', null)]);
  assert.deepEqual(one.email.map(p => p.name), ['Rec']);
  assert.deepEqual(one.note.map(p => p.name), ['NoMail']);
  // No Gmail: nobody is emailed, so the best recruiters get notes.
  assert.deepEqual(pickTargets(many, { canEmail: false }).note.map(p => p.name), ['Uni', 'Rec']);
  // A recruiter the user knows goes first; no recruiters means nobody.
  assert.equal(pickTargets([...many, { ...rec('Pal', 'Recruiter', 'pal@x.com'), knows: true }]).email[0].name, 'Pal');
  assert.deepEqual(pickTargets(others), { email: [], note: [] });
  assert.deepEqual(pickTargets([]), { email: [], note: [] });
  // People who've left aren't asked, unless the user knows them.
  assert.deepEqual(pickTargets([rec('Ex', 'Recruiter | ex-Plaid', 'ex@x.com')]), { email: [], note: [] });
});

test('referral targets: a found address beats a guessed one in the same rank', async () => {
  const { pickTargets } = await import('../services/referralFlow.js');
  const pool = [
    { name: 'Guess', title: 'Recruiter', email: 'guess@x.com', guessed: true },
    { name: 'Found', title: 'Recruiter', email: 'found@x.com' },
    { name: 'UniGuess', title: 'University Recruiter', email: 'uni@x.com', guessed: true },
  ];
  assert.deepEqual(pickTargets(pool).email.map(p => p.name), ['UniGuess', 'Found']);
});

test('referral note: a long list names two people and counts the rest', async () => {
  const { referralNote } = await import('../services/referralFlow.js');
  const asks = ['Ana', 'Bo', 'Cy', 'Di', 'Ed'].map(n => ({ channel: 'email', person_name: n, status: 'draft' }));
  assert.equal(referralNote(asks, 'Fri'), 'Your emails to Ana, Bo and 3 others are waiting for your OK in People → Contacts. Applying Fri unless a referral comes first.');
});

test('referral email: a closing claim about what a project shows is cut, the facts stay', async () => {
  const { plainFit } = await import('../services/referralFlow.js');
  assert.equal(
    plainFit('I built a low‑latency engine in C++17 at 83 ns p50, demonstrating the skills required for the role.\n\nWould you refer me?'),
    'I built a low-latency engine in C++17 at 83 ns p50.\n\nWould you refer me?',
  );
  assert.equal(plainFit('I built an engine. This experience demonstrates my ability to deliver.\n\nThank you.'), 'I built an engine.\n\nThank you.');
  assert.equal(plainFit('I built an engine for the demonstrating team.'), 'I built an engine for the demonstrating team.');
});

test('companyDetail: a true sentence about the company from the posting, never benefits or hype', async () => {
  const { companyDetail, placePhrase, signatureFromTemplate } = await import('../services/referralFlow.js')
  assert.equal(companyDetail('Join us! Lutron designs lighting controls that save energy in homes and offices. We offer great benefits and pay.', 'Lutron'), 'Lutron designs lighting controls that save energy in homes and offices.')
  assert.equal(companyDetail('We build developer tools used by 10,000 engineering teams worldwide.', 'Acme'), 'We build developer tools used by 10,000 engineering teams worldwide.')
  assert.equal(companyDetail('Acme is an equal opportunity employer that provides benefits to all.', 'Acme'), null)
  assert.equal(companyDetail('Acme builds amazing things!', 'Acme'), null)
  assert.equal(companyDetail('', 'Acme'), null)
  assert.equal(placePhrase('Remote - New York City, NY'), ' in New York City, NY (remote)')
  assert.equal(placePhrase('Remote'), ' (remote)')
  assert.equal(placePhrase('San Francisco, CA; Seattle, WA'), ' in San Francisco, CA')
  assert.equal(placePhrase('Austin, TX +2'), ' in Austin, TX')
  assert.equal(placePhrase('Chicago, IL (Remote)'), ' in Chicago, IL (remote)')
  assert.equal(placePhrase(''), '')
  assert.equal(placePhrase('Remote · San Rafael, CA, US'), ' in San Rafael, CA (remote)')
  assert.equal(placePhrase('Boston, MA, US; Boston, MA'), ' in Boston, MA')
  assert.equal(placePhrase('Remote - Georgia, USA'), ' in Georgia (remote)')
  assert.equal(companyDetail('Software Engineer - New Grad, 2027 New York City, New York Who we are At Domino, we build solutions that help the largest, highly regulated organizations adopt AI to accelerate mission-critical use cases.', 'Domino Data Lab'), 'At Domino, we build solutions that help the largest, highly regulated organizations adopt AI to accelerate mission-critical use cases.')
  assert.equal(signatureFromTemplate('Rules...\n\nEnd with exactly this signature:\n\nBest regards,\nA B\nhttps://x'), 'Best regards,\nA B\nhttps://x')
  assert.equal(signatureFromTemplate('no signature here'), null)
})
