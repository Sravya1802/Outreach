import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgres://test:test@localhost:5432/test';
const { safeName, stamp, masterPath, forEvalPath, displayName, resumeFileName, coverLetterFileName } = await import('../services/resumeFiles.js');

const USER = '6f1c2a9e-0000-4000-8000-000000000001';
const AT = new Date('2026-10-14T18:02:07.123Z');

test('safeName keeps a readable PDF name and nothing else', () => {
  assert.equal(safeName('Sravya Resume (2026).pdf'), 'Sravya_Resume_2026_.pdf');
  assert.equal(safeName('../../etc/passwd'), 'passwd.pdf');
  assert.equal(safeName('notes'), 'notes.pdf');
  assert.equal(safeName('RESUME.PDF'), 'RESUME.PDF');
  assert.equal(safeName(''), 'resume.pdf');
  assert.equal(safeName('...'), 'resume.pdf');
  assert.ok(safeName('a'.repeat(300)).length <= 104);
});

test('stamp sorts by time', () => {
  assert.equal(stamp(AT), '20261014-180207');
  assert.ok(stamp(new Date('2026-10-15T00:00:00Z')) > stamp(AT));
});

test('every path starts with the user id', () => {
  assert.equal(masterPath(USER, 'My CV.pdf', AT), `${USER}/master/20261014-180207-My_CV.pdf`);
  assert.equal(forEvalPath(USER, '42', 'tailored', 'Ramp-SWE Intern.pdf', AT), `${USER}/42/tailored-20261014-180207-Ramp-SWE_Intern.pdf`);
  assert.ok(forEvalPath(USER, 7, 'uploaded', '../x.pdf', AT).startsWith(`${USER}/7/uploaded-`));
});

test('every resume goes out under the candidate\'s name, the same for every company', () => {
  assert.equal(resumeFileName('Lakshmi Sravya Rachakonda'), 'Lakshmi Sravya Rachakonda_Resume.pdf');
  assert.equal(coverLetterFileName('Lakshmi Sravya Rachakonda'), 'Lakshmi Sravya Rachakonda_Cover_Letter.pdf');
  assert.equal(resumeFileName(''), 'Resume_Resume.pdf');
  // The name keeps its spaces; paths and quotes can't sneak in.
  assert.equal(displayName('Lakshmi Sravya Rachakonda_Resume.pdf'), 'Lakshmi Sravya Rachakonda_Resume.pdf');
  assert.equal(displayName('../../a"b\nc.pdf'), 'a_b_c.pdf');
  assert.equal(displayName('José Núñez'), 'José Núñez.pdf');
  // Storage paths stay space-free.
  assert.ok(!forEvalPath(USER, 7, 'tailored', resumeFileName('Lakshmi Sravya Rachakonda'), AT).includes(' '));
});
