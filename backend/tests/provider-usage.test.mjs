import assert from 'node:assert/strict'
import test from 'node:test'
import { CACHE_DAYS, cachedDomainSearch, currentMonth, monthlyLimit, spend } from '../services/providerUsage.js'

// Tiny in-memory stand-in for the two tables, honouring the SQL semantics we rely on.
function fakeDb() {
  const usage = new Map()
  const cache = new Map()
  return {
    usage, cache,
    async one(sql, params) {
      if (sql.includes('INSERT INTO provider_usage')) {
        const [user, prov, month, limit] = params
        const k = `${user}|${prov}|${month}`
        const cur = usage.get(k)
        if (cur === undefined) { usage.set(k, 1); return { calls: 1 } }
        if (cur < limit) { usage.set(k, cur + 1); return { calls: cur + 1 } }
        return null
      }
      if (sql.includes('FROM provider_domain_cache')) return cache.get(`${params[0]}|${params[1]}`) || null
      throw new Error('unexpected sql')
    },
    async run(_sql, [prov, domain, result, at]) { cache.set(`${prov}|${domain}`, { result: JSON.parse(result), searched_at: at }); return { rowCount: 1 } },
  }
}

test('monthly budget stops at the limit and resets next month', async () => {
  process.env.HUNTER_USER_MONTHLY_LIMIT = '2'
  const db = fakeDb()
  const oct = new Date('2026-10-13T00:00:00Z')
  await spend('u1', 'hunter', { db, now: oct })
  await spend('u1', 'hunter', { db, now: oct })
  await assert.rejects(spend('u1', 'hunter', { db, now: oct }), (e) => e.code === 'BUDGET' && /2 Hunter lookups/.test(e.message))
  await spend('u2', 'hunter', { db, now: oct }) // other users unaffected
  await spend('u1', 'hunter', { db, now: new Date('2026-11-01T00:00:00Z') })
  assert.equal(currentMonth(oct), '2026-10')
  delete process.env.HUNTER_USER_MONTHLY_LIMIT
  assert.equal(monthlyLimit('hunter'), 15)
})

test('domain cache: one paid lookup serves everyone until it expires', async () => {
  const db = fakeDb()
  let fresh = 0
  const fetchFresh = async () => { fresh++; return { emails: ['x'] } }
  const t0 = new Date('2026-10-13T00:00:00Z')
  const a = await cachedDomainSearch('hunter', 'acme.com', fetchFresh, { userId: 'u1', db, now: t0 })
  const b = await cachedDomainSearch('hunter', 'acme.com', fetchFresh, { userId: 'u2', db, now: new Date(t0.getTime() + 86_400_000) })
  assert.deepEqual([a.cached, b.cached, fresh], [false, true, 1])
  assert.equal(db.usage.size, 1, 'only the miss was charged')
  const c = await cachedDomainSearch('hunter', 'acme.com', fetchFresh, { userId: 'u2', db, now: new Date(t0.getTime() + (CACHE_DAYS + 1) * 86_400_000) })
  assert.deepEqual([c.cached, fresh], [false, 2])
})
