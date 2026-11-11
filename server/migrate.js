/* node migrate.js - creates the tables, then loads the catalogue from js/config.js
   so the dashboard is never empty. Existing rows are left untouched. */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const db = require("./db");
const { importAll } = require("./import-config");

(async function () {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is missing. Put your Neon connection string in server/.env");
    process.exit(1);
  }
  db.configure(process.env.DATABASE_URL);
  await db.migrate();
  const report = await importAll({ query: db.query }, path.join(__dirname, ".."));
  console.log("tables ready");
  console.log(report.skippedProducts
    ? "products already stored - catalogue left as is"
    : "products imported: " + report.products + ", reels: " + report.reels + ", new settings: " + report.settings);
  console.log("next: npm run owner");
  await db.close();
})().catch(function (e) { console.error(e.message || e); process.exit(1); });
