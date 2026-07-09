import pg from 'pg'
import 'dotenv/config'

const { Pool } = pg

// In production, hosted Postgres (Neon, Supabase, Render) gives you a single
// DATABASE_URL and requires SSL. Locally we fall back to the Docker Postgres.
export const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
    })
  : new Pool({
      host:     process.env.PG_HOST     || '127.0.0.1',
      port:     Number(process.env.PG_PORT)     || 5433,
      user:     process.env.PG_USER     || 'pairdesk',
      password: process.env.PG_PASSWORD || 'pairdesk2026',
      database: process.env.PG_DB       || 'pairdesk_dev',
      max: 10,
      idleTimeoutMillis: 30000,
    })

pool.on('error', (err) => console.error('[pg] idle client error', err))

export const query = (text, params) => pool.query(text, params)
