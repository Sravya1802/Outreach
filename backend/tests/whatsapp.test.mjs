import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

process.env.DATABASE_URL ||= 'postgres://x:y@127.0.0.1:1/z';
const { normalizePhone, cleanParam, parseCommand, listMessage, verifyHandshake, signatureOk, waLink, WHATSAPP_TEMPLATES, welcomeMessage, chatReply } = await import('../services/whatsapp.js');

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
  assert.equal(m.params[0], 'Thu, Oct 15');
  assert.equal(m.params[1], '2');
  assert.equal(m.params[2], '1) Ramp · SWE Intern · 9.4  2) Stripe · Data Intern · 9.1');
  assert.match(m.text, /^Your OutreachOS list for Thu, Oct 15: 2 roles to approve\./);
  assert.match(m.text, /1\) Ramp · SWE Intern · 9\.4\n {3}New York\n {3}Kafka match/);
  assert.match(m.text, /Reply YES to approve all, YES 1 3/);
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

test('every template has as many example values as placeholders', () => {
  for (const t of Object.values(WHATSAPP_TEMPLATES)) {
    const n = (t.text.match(/\{\{\d+\}\}/g) || []).length;
    assert.equal(t.example.length, n, t.name);
    assert.ok(!/^\{\{|\}\}$/.test(t.text.trim()), `${t.name} must not start or end with a variable`);
  }
});

test('welcome and small talk', () => {
  const w = welcomeMessage(21);
  assert.match(w, /^✅ \*You’re connected to OutreachOS\*/);
  assert.match(w, /evening list is ready \(9 PM\)/);
  assert.match(w, /\*YES 1 3\*  approve only those numbers/);
  assert.match(chatReply('thank you'), /^You’re welcome!/);
  assert.match(chatReply('Thanks!'), /^You’re welcome!/);
  assert.match(chatReply('hi'), /^Hi! 👋/);
  assert.match(chatReply('what is this'), /Reply \*HELP\*/);
});
