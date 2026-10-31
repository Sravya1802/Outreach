import assert from 'node:assert/strict'
import test from 'node:test'
import { parseYearFilter, yearCondition } from '../services/gradYear.js'

test('year filter: 2027, 2027-or-unstated, junk ignored', () => {
  assert.deepEqual(parseYearFilter('2027'), { year: '2027', orUnstated: false })
  assert.deepEqual(parseYearFilter('2027-or-unstated'), { year: '2027', orUnstated: true })
  for (const bad of ['', '27', '2031', "2027'; drop", '2027-or-whatever', undefined]) assert.equal(parseYearFilter(bad), null)
})

test('year condition: numbered params continue from the caller, values never in the SQL text', () => {
  const says = yearCondition(parseYearFilter('2027'), 4)
  assert.match(says.sql, /title ~ \$4 .*~\* \$5/)
  assert.deepEqual(says.params.map(p => p.includes('2027')), [true, true])
  const open = yearCondition(parseYearFilter('2027-or-unstated'), 4)
  assert.match(open.sql, /OR NOT \(title ~ \$6 .*~\* \$7\)/)
  assert.equal(open.params.length, 4)
  assert.ok(!open.sql.includes('2027'))
  assert.equal(yearCondition(null, 4), null)
})
