import assert from 'node:assert/strict'
import test from 'node:test'
import { isWithin, parseId } from '../services/safePaths.js'

test('isWithin only accepts paths inside the base directory', () => {
  const base = '/srv/app/data/resumes'
  assert.equal(isWithin(base, '/srv/app/data/resumes/12/cv.pdf'), true)
  assert.equal(isWithin(base, '12/cv.pdf'), true)
  assert.equal(isWithin(base, '/srv/app/.env'), false)
  assert.equal(isWithin(base, '/srv/app/data/resumes/../../.env'), false)
  assert.equal(isWithin(base, '/srv/app/data/resumes-evil/x.pdf'), false)
  assert.equal(isWithin(base, 'storage://resume-library/x.pdf'), false)
  assert.equal(isWithin(base, ''), false)
  assert.equal(isWithin(base, null), false)
  assert.equal(isWithin(base, '/srv/app/data/resumes/a\0.pdf'), false)
})

test('parseId accepts positive integers only', () => {
  assert.equal(parseId('42'), 42)
  assert.equal(parseId(7), 7)
  for (const bad of ['0', '-1', '1.5', '1e3', '..%2F..', '../../tmp', '', null, undefined, '12abc', '99999999999999999']) {
    assert.equal(parseId(bad), null, String(bad))
  }
})
