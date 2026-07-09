import { DuckDBInstance } from '@duckdb/node-api'
import path from 'path'
import { fileURLToPath } from 'url'
import 'dotenv/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Where the parquet files live. Override with PARQUET_DIR in production
// (e.g. the copy bundled into the container image); defaults to the repo layout.
const PARQUET_DIR = process.env.PARQUET_DIR
  ? path.resolve(process.env.PARQUET_DIR)
  : path.resolve(__dirname, '../../../Data/parquet')

export const PARQUET = {
  spot: path.join(PARQUET_DIR, 'spot_bars.parquet'),
  fut:  path.join(PARQUET_DIR, 'fut_bars.parquet'),
  cont: path.join(PARQUET_DIR, 'fut_continuous.parquet'),
}

let _db = null

async function getDb() {
  if (!_db) _db = await DuckDBInstance.create(':memory:')
  return _db
}

// Returns plain JS array of row objects
export async function duckQuery(sql) {
  const db = await getDb()
  const con = await db.connect()
  try {
    const reader = await con.runAndReadAll(sql)
    return reader.getRowObjects().map((row) => Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        typeof value === 'bigint' ? Number(value) : value,
      ]),
    ))
  } finally {
    con.disconnectSync()
  }
}
