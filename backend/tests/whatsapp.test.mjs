import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

process.env.DATABASE_URL ||= 'postgres://x:y@127.0.0.1:1/z';
const { normalizePhone, cleanParam, parseCommand, listMessage, verifyHandshake, signatureOk, waLink, WHATSAPP_TEMPLATES, templateDefinition, welcomeMessage, chatReply } = await import('../services/whatsapp.js');

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
  assert.deepEqual(parseCommand('List'), { cmd: 'list' });
  assert.deepEqual(parseCommand('STOP'), { cmd: 'stop' });
  assert.deepEqual(parseCommand('help'), { cmd: 'help' });
  assert.equal(parseCommand('thanks!'), null);
  assert.equal(parseCommand('join 12'), null);
});

test('list message numbers roles the way YES 1 3 reads them', () => {
  const m = listMessage([
    { company_name: 'Ramp', title: 'SWE Intern', score: '9.4', location: 'New York', reason: 'Kafka match' },
    { company_name: 'Stripe', title: 'Data Intern', score: 9.1 },
  ], '2026-10-15');
  assert.equal(m.params.header, 'Thu, Oct 15');
  assert.deepEqual(m.params.body, ['2', '1) Ramp · SWE Intern · 9.4  2) Stripe · Data Intern · 9.1']);
  assert.match(m.text, /^\*Tonight’s list · Thu, Oct 15\*\nHello,\n2 roles scored 9\+ today:/);
  assert.match(m.text, /\*1\)\*\nCompany: \*Ramp\*\nRole: SWE Intern\nScore: 9\.4\/10\nWhere: New York\nWhy: _Kafka match_\n/);
  assert.match(m.text, /Reply \*YES\* to approve all, or \*YES 1 3\*/);
  assert.match(m.text, /Good luck! ;\)$/);
});

test('webhook handshake and signature', () => {
  process.env.WHATSAPP_VERIFY_TOKEN = 'tok';
  assert.equal(verifyHandshake({ 'hub.mode': 'subscribe', 'hub.verify_token': 'tok', 'hub.challenge': '42' }), '42');
  assert.equal(verifyHandshake({ 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': '42' }), null);
  process.env.WHATSAPP_APP_SECRET = 's3cret';
  const body = Buffer.from('{"entry":[]}');
  const sig = `sha256=${crypto.createHmac('sha256', 's3cret').update(body).digest('hex')}`;
  assert.ok(signatureOk(body, sig));
  assert.ok(!signatureOk(body, 'sha256=00'));
  assert.ok(!signatureOk(body, undefined));
  delete process.env.WHATSAPP_APP_SECRET;
  assert.ok(!signatureOk(body, sig), 'unsigned webhooks are refused when no secret is set');
  delete process.env.WHATSAPP_VERIFY_TOKEN;
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
  assert.match(m.text, /\/profile\/projects/);
});
