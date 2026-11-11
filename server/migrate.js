/* node migrate.js - creates the tables and the default settings row */
require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const db = require("./db");
const S = require("./shop");

(async function () {
  if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is required"); process.exit(1); }
  db.configure(process.env.DATABASE_URL);
  await db.migrate();
  await S.upsertSettings({ query: db.query });
  console.log("schema applied and default settings stored");
  await db.close();
})().catch(function (e) { console.error(e.message); process.exit(1); });
