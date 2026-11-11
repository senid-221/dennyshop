/* Database access. One query() surface so the test suite can swap in pg-mem. */
const fs = require("fs");
const path = require("path");

let pool = null;

function configure(databaseUrl) {
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const { Pool } = require("pg");
  pool = new Pool({
    connectionString: databaseUrl,
    ssl: /sslmode=require|neon\.tech/.test(databaseUrl) ? { rejectUnauthorized: false } : undefined,
  });
  return pool;
}

async function query(text, params) {
  if (!pool) throw new Error("database not configured");
  const res = await pool.query(text, params);
  return res.rows;
}

async function tx(fn) {
  if (!pool) throw new Error("database not configured");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn({
      query: async (text, params) => (await client.query(text, params)).rows,
    });
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await query(sql);
}

async function close() {
  if (pool) await pool.end();
  pool = null;
}

module.exports = { configure, query, tx, migrate, close, get pool() { return pool; } };
