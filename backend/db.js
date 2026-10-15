// ─────────────────────────────────────────────────────────────────────────────
// Scout’n’Jobs backend DB module — Postgres (Supabase) via node-postgres.
//
// Replaces the original better-sqlite3 version. Same logical responsibility
// (app-wide singleton Pool + convenience helpers) but the helpers are async.
//
// CONNECTION:
//   Set DATABASE_URL in .env to your Supabase connection string. Use the
//   "Connection string" → URI from Supabase → Project Settings → Database.
//   Recommend the pooler URL (port 6543) for apps with lots of short queries,
//   or the direct URL (port 5432) for long-lived backends like ours.
//
// USAGE (migrating routes from sqlite):
//   before:  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
//   after:   const row = await one('SELECT * FROM jobs WHERE id = $1', [id]);
//
//   before:  const rows = db.prepare('SELECT * FROM jobs').all();
//   after:   const rows = await all('SELECT * FROM jobs');
//
//   before:  const r = db.prepare('INSERT INTO jobs (...) VALUES (...)').run(...);
//   after:   const r = await run('INSERT INTO jobs (...) VALUES (...) RETURNING id', ...);
//            // r.insertId, r.rowCount available
//
//   before:  db.transaction(() => { ... })()
//   after:   await tx(async (client) => { ... /* uses client.query */ })
//
// DIALECT TRANSLATIONS (sqlite → Postgres):
//   ?, ?, ?                        $1, $2, $3
//   INSERT OR IGNORE               INSERT ... ON CONFLICT DO NOTHING
//   INSERT OR REPLACE              INSERT ... ON CONFLICT (pk) DO UPDATE SET ...
//   datetime('now')                NOW() or CURRENT_TIMESTAMP
//   AUTOINCREMENT                  (gone — use BIGSERIAL)
//   LAST_INSERT_ROWID()            replaced with INSERT ... RETURNING id
//   BOOLEAN 0/1                    BOOLEAN false/true (pg auto-casts though)
// ─────────────────────────────────────────────────────────────────────────────

import pg from 'pg'
const { Pool, types } = pg

// Parse DATE/TIMESTAMP columns as ISO strings (matches sqlite TEXT behavior
// — keeps the rest of the app from having to care about Date objects).
types.setTypeParser(1082, (v) => v)                       // DATE
types.setTypeParser(1114, (v) => v)                       // TIMESTAMP WITHOUT TZ
types.setTypeParser(1184, (v) => v ? new Date(v).toISOString() : null) // TIMESTAMPTZ

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('[db] FATAL: DATABASE_URL not set. Cannot start backend without a Postgres connection string.')
  console.error('     Get it from Supabase → Project Settings → Database → Connection string')
  process.exit(1)
}

// Use direct connection (port 5432) for this VM backend — we have persistent
// connections and can benefit from prepared-statement caching. The pooler
// (port 6543) is recommended for lots of short-lived processes like serverless.
export const pool = new Pool({
  connectionString,
  max: 10,                   // connection pool ceiling — 10 is plenty for 4 users
  idleTimeoutMillis: 30_000, // drop idle connections after 30s
  connectionTimeoutMillis: 10_000,
  ssl: { rejectUnauthorized: false }, // Supabase requires SSL
})

pool.on('error', (err) => {
  console.error('[db] Unexpected pool error:', err)
})

// ── Convenience helpers ─────────────────────────────────────────────────────

/**
 * Run a query and return the full pg Result object.
 * @param {string} sql
 * @param {Array} [params]
 * @returns {Promise<import('pg').QueryResult>}
 */
export async function query(sql, params = []) {
  return pool.query(sql, params)
}

/**
 * Return the first row (or null). Equivalent to sqlite's `.get()`.
 * @template T
 * @param {string} sql
 * @param {Array} [params]
 * @returns {Promise<T | null>}
 */
export async function one(sql, params = []) {
  const r = await pool.query(sql, params)
  return r.rows[0] ?? null
}

/**
 * Return all rows as an array. Equivalent to sqlite's `.all()`.
 * @template T
 * @param {string} sql
 * @param {Array} [params]
 * @returns {Promise<T[]>}
 */
export async function all(sql, params = []) {
  const r = await pool.query(sql, params)
  return r.rows
}

/**
 * Run a mutating statement. Returns { rowCount, insertId } where insertId is
 * populated if the SQL has `RETURNING id`. Equivalent to sqlite's `.run()`.
 * @param {string} sql
 * @param {Array} [params]
 * @returns {Promise<{ rowCount: number, insertId: number|string|null, rows: any[] }>}
 */
export async function run(sql, params = []) {
  const r = await pool.query(sql, params)
  return {
    rowCount: r.rowCount ?? 0,
    insertId: r.rows?.[0]?.id ?? null,
    rows: r.rows ?? [],
  }
}

/**
 * Transaction wrapper. Pass a fn that receives a dedicated client with the
 * same query API. BEGIN/COMMIT/ROLLBACK handled automatically.
 * @template T
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function tx(fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    try { await client.query('ROLLBACK') } catch {}
    throw err
  } finally {
    client.release()
  }
}

// ── Startup ping ─────────────────────────────────────────────────────────────
// Fires on first query — fails fast if the connection string is wrong.
let pingDone = false
export async function pingDb() {
  if (pingDone) return
  try {
    const r = await pool.query('SELECT NOW() AS now, current_database() AS db, version() AS version')
    const row = r.rows[0]
    console.log(`[db] Connected to ${row.db} @ ${row.now.toISOString?.() ?? row.now}`)
    console.log(`[db] ${row.version.split(',')[0]}`)
    pingDone = true
  } catch (err) {
    console.error('[db] Failed to connect:', err.message)
    process.exit(1)
  }
}

// ── Shim: legacy `db.prepare(...)` throws loudly ─────────────────────────────
// Catches code that wasn't migrated yet. Each such call must be async-ified.
const db = {
  prepare: (sql) => {
    throw new Error(
      `[db] Legacy sync call db.prepare() — must be migrated to async.\n` +
      `     SQL: ${sql.slice(0, 120)}...\n` +
      `     Use: await one(sql, params) / all(sql, params) / run(sql, params)`
    )
  },
  exec: (sql) => {
    throw new Error(
      `[db] Legacy sync call db.exec() — must be migrated to async.\n` +
      `     SQL: ${sql.slice(0, 120)}...\n` +
      `     Use: await query(sql) or await run(sql)`
    )
  },
  transaction: () => {
    throw new Error(`[db] Legacy sync db.transaction() — must be migrated to async. Use: await tx(async client => { ... })`)
  },
  pragma: () => { /* no-op — pg doesn't have pragmas */ },
}

export default db

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[db] SIGTERM received — closing pool')
  try { await pool.end() } catch {}
  process.exit(0)
})
process.on('SIGINT', async () => {
  console.log('[db] SIGINT received — closing pool')
  try { await pool.end() } catch {}
  process.exit(0)
})
