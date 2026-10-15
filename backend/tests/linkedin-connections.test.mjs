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
