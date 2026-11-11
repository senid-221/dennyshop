/* Vercel serverless entry. Vercel does not run a listening Express server, so
   the same app from server/app.js is exported as one function and the static
   pages are served by Vercel itself. */
const { createApp } = require("../server/app");

let pool = null;
let db = null;

/* one pool per warm function container, created on first use so a missing
   environment variable does not break static page delivery */
function ensureDb() {
  if (db) return db;
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set in this environment");
  const { Pool } = require("pg");
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 3,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 15000,
  });
  pool.on("error", function (e) { console.error("pg pool error:", e.message); });
  db = {
    query: async function (text, params) {
      const res = await pool.query(text, params);
      return res.rows;
    },
    tx: async function (fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const out = await fn({
          query: async function (t, p) { return (await client.query(t, p)).rows; },
        });
        await client.query("COMMIT");
        return out;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },
  };
  return db;
}

const lazy = {
  query: function (t, p) { return ensureDb().query(t, p); },
  tx: function (fn) { return ensureDb().tx(fn); },
};

const app = createApp({
  db: lazy,
  cfg: {
    staticDir: null,                       /* Vercel serves the html, css, images and reels */
    secureCookies: process.env.INSECURE_COOKIES === "1" ? false : true,
    siteUrl: process.env.PUBLIC_URL || "",
  },
});

/* A rewrite can hand the function the rewritten path, so put the real request
   path back before Express matches routes like /r/eric or /api/shop. */
module.exports = function handler(req, res) {
  const forwarded = req.headers["x-forwarded-path"] || req.headers["x-original-url"] || "";
  if (forwarded && req.url.indexOf(forwarded) !== 0) {
    const query = (req.url.split("?")[1] || "");
    req.url = forwarded + (query ? "?" + query : "");
  }
  /* the API must never be cached: prices, stock and orders change constantly */
  res.setHeader("Cache-Control", "no-store");
  return app(req, res);
};
