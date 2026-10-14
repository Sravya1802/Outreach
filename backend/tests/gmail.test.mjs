import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgres://x:y@127.0.0.1:1/z'; // modules import db.js; these tests make no queries
const { normalizeAppPassword, isAppPassword, friendlyGmailError, newMessageId } = await import('../services/gmail.js');
const { parseHeaderBlock, messageIdsIn, linkedinEvent, looksAutoReply, isBounceSender, normName, describeEvent } = await import('../services/replyWatcher.js');
const { followupBody } = await import('../services/outbox.js');

test('app passwords: Google shows them in four groups', () => {
  assert.equal(normalizeAppPassword('abcd efgh ijkl mnop'), 'abcdefghijklmnop');
  assert.ok(isAppPassword('abcd efgh ijkl mnop'));
  assert.ok(!isAppPassword('hunter2'));
  assert.ok(!isAppPassword('abcd1234efgh5678'));
});

test('Gmail errors in plain words', () => {
  assert.match(friendlyGmailError({ code: 'EAUTH', responseCode: 535, message: 'Invalid login' }), /didn’t accept that app password/);
  assert.match(friendlyGmailError({ message: 'AUTHENTICATIONFAILED Invalid credentials' }), /didn’t accept/);
  assert.match(friendlyGmailError({ code: 'ETIMEDOUT' }), /Couldn’t reach Gmail/);
  assert.match(newMessageId('a@gmail.com'), /^<oos-[0-9a-f-]{36}@gmail\.com>$/);
});

test('thread headers', () => {
  const h = parseHeaderBlock('In-Reply-To: <oos-1@gmail.com>\r\nReferences: <a@x>\r\n <oos-1@gmail.com>\r\nAuto-Submitted: auto-replied\r\n');
  assert.deepEqual(messageIdsIn(h.references), ['<a@x>', '<oos-1@gmail.com>']);
  assert.deepEqual(messageIdsIn(h['in-reply-to']), ['<oos-1@gmail.com>']);
  assert.ok(looksAutoReply(h, 'Re: hello'));
  assert.ok(looksAutoReply({}, 'Out of Office: back Monday'));
  assert.ok(looksAutoReply({}, 'Automatic reply: Re: Internship'));
  assert.ok(!looksAutoReply({ 'auto-submitted': 'no' }, 'Re: Internship question'));
});

test('LinkedIn notification emails', () => {
  assert.deepEqual(linkedinEvent('Ana Lee has accepted your invitation. Let’s start a conversation'), { kind: 'linkedin_accept', name: 'Ana Lee' });
  assert.deepEqual(linkedinEvent('Ana Lee accepted your invitation'), { kind: 'linkedin_accept', name: 'Ana Lee' });
  assert.deepEqual(linkedinEvent('Ana Lee just messaged you'), { kind: 'linkedin_message', name: 'Ana Lee' });
  assert.deepEqual(linkedinEvent('Ana Lee sent you a new message'), { kind: 'linkedin_message', name: 'Ana Lee' });
  assert.deepEqual(linkedinEvent('New message from José Núñez'), { kind: 'linkedin_message', name: 'José Núñez' });
  assert.equal(linkedinEvent('5 people viewed your profile'), null);
  assert.equal(linkedinEvent('Ana Lee wants to connect'), null);
  assert.equal(normName('José  Núñez'), 'jose nunez');
});

test('bounces and event wording', () => {
  assert.ok(isBounceSender('mailer-daemon@googlemail.com'));
  assert.ok(!isBounceSender('ana@ramp.com'));
  assert.equal(describeEvent({ kind: 'reply', snippet: 'Happy to chat Thursday', contact: { name: 'Ana Lee', company_name: 'Ramp' } }), 'Ana Lee (Ramp) replied: “Happy to chat Thursday”');
  assert.match(describeEvent({ kind: 'bounce', contact: { name: 'Ana Lee' } }), /bounced/);
});

test('follow-ups quote the original and stay short', () => {
  const b = followupBody(1, { toName: 'Ana Lee', company: 'Ramp', sender: 'Sravya R', original: 'Hi Ana,\nI applied to the SWE intern role.', sentAt: new Date('2026-10-15T14:00:00Z'), tz: 'America/New_York' });
  assert.match(b, /^Hi Ana,\n\nFollowing up on my note below/);
  assert.match(b, /On Thu, Oct 15, 2026, Sravya R wrote:\n> Hi Ana,\n> I applied/);
  assert.match(followupBody(2, { toName: '', company: 'Ramp', sender: '', original: 'x', sentAt: new Date(), tz: 'UTC' }), /^Hi there,\n\nOne last note.*Ramp's internship/s);
});
