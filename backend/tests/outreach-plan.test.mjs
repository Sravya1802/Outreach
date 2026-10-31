import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgres://x:y@127.0.0.1:1/z';
const { groupPlan, mergeCompanies } = await import('../services/outreachPlan.js');

test('each planned email comes with its LinkedIn note; everyone else is listed after', () => {
  const contacts = [
    { id: 1, name: 'Ana Lee', title: 'Recruiter', email: 'ana@x.com', email_status: 'valid', linkedin_url: 'https://www.linkedin.com/in/ana', status: 'pending' },
    { id: 2, name: 'Bo Ng', title: 'Engineer', email: 'bo@x.com', email_status: 'guessed', linkedin_url: null, status: 'sent' },
    { id: 3, name: 'Cy Diaz', title: 'Manager', email: null, email_status: null, linkedin_url: 'https://www.linkedin.com/in/cy', status: 'pending' },
    { id: 4, name: 'Di Park', title: 'Designer', email: 'di@x.com', email_status: 'valid', linkedin_url: null, status: 'pending' },
  ];
  const outbox = [
    { id: 10, contact_id: 1, step: 0, status: 'draft', subject: 'Referral?' },
    { id: 11, contact_id: 2, step: 0, status: 'sent', subject: 'Referral?' },
    { id: 12, contact_id: 2, step: 1, status: 'scheduled', subject: 'Re: Referral?' },
    { id: 13, contact_id: 4, step: 0, status: 'cancelled', subject: 'Discarded' },
  ];
  const asks = [
    { id: 100, channel: 'email', person_name: 'Ana Lee', contact_id: 1, status: 'draft', role_title: 'SWE', role_url: 'https://x/swe' },
    { id: 101, channel: 'linkedin', person_name: 'Ana Lee', contact_id: 1, status: 'to_send', message: 'Hi Ana', linkedin_url: 'https://www.linkedin.com/in/ana', role_title: 'SWE', role_url: 'https://x/swe' },
    { id: 102, channel: 'email', person_name: 'Bo Ng', contact_id: 2, status: 'sent', role_title: 'SWE' },
    { id: 103, channel: 'linkedin', person_name: 'Bo Ng', contact_id: 2, status: 'marked_sent', message: 'Hi Bo', linkedin_url: 'https://www.linkedin.com/search/results/people/?keywords=Bo', role_title: 'SWE' },
    { id: 104, channel: 'linkedin', person_name: 'Eve Friend', contact_id: null, status: 'to_send', message: 'Hi Eve', linkedin_url: 'https://www.linkedin.com/in/eve', role_title: 'SWE' },
    { id: 105, channel: 'search', person_name: null, contact_id: null, status: 'to_send', message: 'Hi, …', linkedin_url: 'https://www.linkedin.com/search/results/people/?keywords=X' },
  ];
  const g = groupPlan({ contacts, outbox, asks });
  // Waiting for your OK first, then sent; a note-only person (Eve) after the emails.
  assert.deepEqual(g.planned.map(p => p.name), ['Ana Lee', 'Bo Ng', 'Eve Friend']);
  assert.equal(g.planned[0].email.id, 10);
  assert.deepEqual(g.planned[0].note, { id: 101, message: 'Hi Ana', status: 'to_send', linkedinUrl: 'https://www.linkedin.com/in/ana' });
  assert.deepEqual(g.planned[0].role, { title: 'SWE', url: 'https://x/swe' });
  assert.equal(g.planned[1].email.id, 11, 'the first email, not its follow-up');
  assert.equal(g.planned[1].note.status, 'marked_sent');
  assert.equal(g.planned[2].email, null);
  // A discarded email isn't planned: Di is with everyone else, and so is Cy.
  assert.deepEqual(g.others.map(p => p.name), ['Cy Diaz', 'Di Park']);
  assert.ok(!('email' in g.others[0]) && !('note' in g.others[0]));
  assert.equal(g.search.id, 105);
  assert.deepEqual(g.roles, [{ title: 'SWE', url: 'https://x/swe' }]);
});

test('companies waiting on you come first', () => {
  const rows = mergeCompanies({
    people: [{ key: 'acme', name: 'Acme', n: 5, latest: 9 }, { key: 'zed', name: 'Zed', n: 2, latest: 20 }, { key: 'ramp', name: 'Ramp', n: 3, latest: 1 }],
    mail: [{ key: 'ramp', waiting: 2, scheduled: 0, sent: 1 }],
    notes: [{ key: 'ramp', name: 'Ramp', to_send: 2, sent: 0 }, { key: 'solo', name: 'Solo Inc', to_send: 1, sent: 0 }],
  });
  assert.deepEqual(rows.map(r => r.name), ['Ramp', 'Solo Inc', 'Zed', 'Acme']);
  assert.deepEqual(rows[0], { key: 'ramp', name: 'Ramp', people: 3, waiting: 2, scheduled: 0, sent: 1, notesToSend: 2, notesSent: 0 });
  assert.equal(rows[1].people, 0);
});
