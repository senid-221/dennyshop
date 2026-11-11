/* node seed.js - (re)imports products, reels and settings from js/config.js.
   migrate.js already does this; run this only to force a look-over. */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const db = require("./db");
const { importAll } = require("./import-config");

(async function () {
  if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is missing"); process.exit(1); }
  db.configure(process.env.DATABASE_URL);
  const report = await importAll({ query: db.query }, path.join(__dirname, ".."));
  console.log(report.skippedProducts
    ? "products already stored - nothing imported"
    : "products imported: " + report.products + ", reels: " + report.reels + ", new settings: " + report.settings);
  await db.close();
})().catch(function (e) { console.error(e.message || e); process.exit(1); });
