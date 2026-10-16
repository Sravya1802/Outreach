import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeAgency } from '../services/staffing.js';

test('agencies by name', () => {
  for (const c of ['TalentHop', 'Employia', 'Divine Talent', 'Aavalar Consulting, Inc', 'Robert Half', 'Insight Global', 'Jobot', 'ABC Staffing LLC', 'Bright Recruiting Group', 'Apex Systems'])
    assert.ok(looksLikeAgency(c).agency, c);
});

test('real employers are kept, even with tricky words', () => {
  for (const c of ['Salesforce', 'CoreWeave', 'Instacart', 'NIKE', 'VAST Data', 'Analog Devices', 'Hasbro', 'Talend', 'Hiretech Robotics', 'Eide Bailly', 'Accenture', 'Deloitte', 'BAE Systems, Inc.', 'Apple Inc', 'Cisco Systems', 'Oracle Consulting Services', 'Palantir Technologies'])
    assert.ok(!looksLikeAgency(c).agency, c);
});

test('agencies by how the posting reads', () => {
  const jd = 'Our client, a Fortune 500 company, is hiring. This is a contract-to-hire role. W2 or C2C accepted.';
  assert.ok(looksLikeAgency('Acme Solutions', jd).agency);
  assert.ok(!looksLikeAgency('Acme Robotics', 'We build robots. Join our client success team.').agency, 'one weak signal is not enough');
  assert.ok(looksLikeAgency('Acme Talent', 'Our client is hiring a new grad engineer.').agency, 'one signal plus an agency-ish name');
});
