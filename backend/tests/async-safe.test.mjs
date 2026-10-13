import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import { installAsyncSafety } from '../middleware/asyncSafe.js'

test('rejected async handlers reach the error handler instead of crashing', async () => {
  const app = express()
  const router = express.Router()
  router.get('/boom', async () => { throw new Error('db down') })
  router.get('/sync', () => { throw new Error('sync boom') })
  router.get('/ok', async (_req, res) => { res.json({ ok: true }) })
  app.use('/api/x', router)
  app.get('/top', async () => { await Promise.reject(new Error('top-level')) })
  installAsyncSafety(app)
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }))

  const server = app.listen(0)
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    for (const [path, msg] of [['/api/x/boom', 'db down'], ['/api/x/sync', 'sync boom'], ['/top', 'top-level']]) {
      const r = await fetch(base + path)
      assert.equal(r.status, 500, path)
      assert.deepEqual(await r.json(), { error: msg })
    }
    assert.deepEqual(await (await fetch(`${base}/api/x/ok`)).json(), { ok: true })
  } finally {
    server.close()
  }
})
