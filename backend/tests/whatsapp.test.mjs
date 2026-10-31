import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

process.env.DATABASE_URL ||= 'postgres://x:y@127.0.0.1:1/z';
const { normalizePhone, cleanParam, parseCommand, pickListMessage, eveningMessage, verifyHandshake, signatureOk, waLink, WHATSAPP_TEMPLATES, templateDefinition, welcomeMessage, chatReply } = await import('../services/whatsapp.js');

test('phone numbers', () => {
  assert.equal(normalizePhone('+1 (555) 010-2000'), '15550102000');
  assert.equal(normalizePhone('0091 98765 43210'), '919876543210');
  assert.equal(normalizePhone('123'), null);
  assert.equal(waLink('+1 555 010 2000', 'JOIN 123456'), 'https://wa.me/15550102000?text=JOIN%20123456');
});

test('template parameters lose newlines and long space runs', () => {
  assert.equal(cleanParam('a\nb\tc     d'), 'a · b · c   d');
  assert.equal(cleanParam(''), '-');
  assert.equal(cleanParam('x'.repeat(800)).length, 700);
});

test('reply commands', () => {
  assert.deepEqual(parseCommand('JOIN 482913'), { cmd: 'join', code: '482913' });
  assert.deepEqual(parseCommand('yes'), { cmd: 'yes', picks: 'all' });
  assert.deepEqual(parseCommand('YES 1 3, 3'), { cmd: 'yes', picks: [1, 3] });
  assert.deepEqual(parseCommand('skip 2'), { cmd: 'skip', picks: [2] });
  assert.deepEqual(parseCommand('APP 1 3, 12'), { cmd: 'app', picks: [1, 3, 12] });
  assert.deepEqual(parseCommand('mine 2'), { cmd: 'mine', picks: [2] });
  assert.equal(parseCommand('app'), null);
  assert.equal(parseCommand('mine all'), null);
  assert.deepEqual(parseCommand('List'), { cmd: 'list' });
  assert.deepEqual(parseCommand('STOP'), { cmd: 'stop' });
  assert.deepEqual(parseCommand('help'), { cmd: 'help' });
  assert.equal(parseCommand('thanks!'), null);
  assert.equal(parseCommand('join 12'), null);
});

test('pick list keeps each role’s number on today’s list, and stays short for the template', () => {
  const m = pickListMessage([
    { num: 1, company_name: 'Ramp', title: 'SWE Intern', score: '9.4', pay: '$55/hr' },
    { num: 4, company_name: 'Stripe', title: 'Data Intern', score: 9.1 },
  ], 'Thu, Oct 15');
  assert.equal(m.params.header, 'Thu, Oct 15');
  assert.deepEqual(m.params.body, ['2', '1) Ramp · SWE Intern · 9.4  4) Stripe · Data Intern · 9.1']);
  assert.match(m.text, /^\*Roles to pick · Thu, Oct 15\*\nHello,\n2 roles match you:/);
  assert.match(m.text, /\*1\)\* Ramp · SWE Intern · 9\.4 · \$55\/hr\n\*4\)\* Stripe · Data Intern · 9\.1/);
  assert.match(m.text, /Reply \*APP 1 3\*/);
  assert.match(m.text, /Good luck! ;\)$/);
  const many = pickListMessage(Array.from({ length: 60 }, (_, k) => ({ company_name: `Company ${k}`, title: 'Software Engineer, New Grad', score: 8 })), '12 new', { fresh: true });
  assert.ok(many.params.body[1].length < 700 && /\+\d+ more$/.test(many.params.body[1]));
  assert.match(many.text, /60 new roles match you since this morning/);
  assert.match(many.text, /…and 20 more on the site\./);
});

test('evening message: drafts to approve and your own resumes to finish', () => {
  const m = eveningMessage({
    ready: [{ company_name: 'Ramp', title: 'SWE', t_ats: 93 }],
    drafting: [{ company_name: 'Figma', title: 'Data' }],
    own: [{ company_name: 'Amazon', title: 'SDE I' }, { company_name: 'Microsoft', title: 'SWE' }],
    label: 'Fri, Oct 31',
  });
  assert.deepEqual(m.params, { header: 'Fri, Oct 31', body: ['Ramp', 'Amazon, Microsoft'] });
  assert.match(m.text, /\*Drafts ready to approve \(1\)\*\n• Ramp · SWE · ATS 93%/);
  assert.match(m.text, /\*Still drafting \(1\)\*\n• Figma · Data/);
  assert.match(m.text, /\*Your own resumes \(2\)\*: did you finish them\?\n• Amazon · SDE I\n• Microsoft · SWE\nUpload the PDF/);
  assert.equal(m.subject, '1 draft to approve · 2 resumes of your own to finish · Fri, Oct 31');
  assert.ok(!m.plain.includes('*'));
  assert.deepEqual(eveningMessage({ own: [{ company_name: 'Cursor', title: 'SWE' }], label: 'x' }).params.body, ['none yet', 'Cursor']);
});

test('every template has as many example values as placeholders, and a valid shape', () => {
  for (const [kind, t] of Object.entries(WHATSAPP_TEMPLATES)) {
    const n = (t.body.text.match(/\{\{\d+\}\}/g) || []).length;
    assert.equal(t.body.example.length, n, t.name);
    assert.ok(!/^\{\{|\}\}$/.test(t.body.text.trim()), `${t.name} body must not start or end with a variable`);
    const h = (t.header.text.match(/\{\{\d+\}\}/g) || []).length;
    assert.ok(h <= 1 && (h === 1) === Boolean(t.header.example), `${t.name} header`);
    assert.ok(t.header.text.length <= 60 && t.footer.length <= 60);
    const d = templateDefinition(kind);
    assert.equal(d.components.map(c => c.type).join(','), 'HEADER,BODY,FOOTER,BUTTONS');
    assert.match(d.components[3].buttons[0].url, /^https:\/\//);
  }
});

test('projects message: short line for the template, full text inside the window', async () => {
  const { projectsMessage } = await import('../services/whatsapp.js');
  const m = projectsMessage([
    { name: 'TrialMatch API | Clinical Trial Eligibility Service', covers: ['C#', '.NET', 'CI/CD'], demand: { roles: 19, of: 30 } },
    { name: 'OpsAgent | LangGraph Agent', covers: ['LangGraph'], demand: null },
  ]);
  assert.equal(m.params.header, '2 new');
  assert.equal(m.params.body[0], '1) TrialMatch API · C#, .NET, CI/CD · 19 of 30 roles  2) OpsAgent · LangGraph · for one role');
  assert.match(m.text, /\*1\) TrialMatch API \| Clinical Trial Eligibility Service\*\nAdds: C#, \.NET, CI\/CD\nHelps: 19 of 30 roles/);
  assert.match(m.text, /\/resumes\/projects/);
});

test('ADD replies and the skills question', async () => {
  const { parseCommand, skillsMessage } = await import('../services/whatsapp.js');
  assert.deepEqual(parseCommand('ADD 1 3'), { cmd: 'add', picks: [1, 3] });
  assert.deepEqual(parseCommand('add 2, 4 and 5'), { cmd: 'add', picks: [2, 4, 5] });
  assert.deepEqual(parseCommand('ADD ALL'), { cmd: 'add', picks: 'all' });
  assert.equal(parseCommand('add me to the list'), null);
  const m = skillsMessage({ company: 'Stripe', title: 'SWE, New Grad', terms: ['Kafka', 'Go'] });
  assert.equal(m.params.header, 'Stripe');
  assert.deepEqual(m.params.body, ['Stripe · SWE, New Grad', '1) Kafka  2) Go']);
  assert.match(m.text, /1\) Kafka\n2\) Go/);
});

test('APPLIED replies', async () => {
  const { parseCommand } = await import('../services/whatsapp.js');
  assert.deepEqual(parseCommand('APPLIED 2 4'), { cmd: 'applied', picks: [2, 4] });
  assert.deepEqual(parseCommand('applied all'), { cmd: 'applied', picks: 'all' });
  assert.equal(parseCommand('applied to google yesterday'), null);
});
