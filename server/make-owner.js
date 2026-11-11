/* node make-owner.js - creates or promotes the owner account.
   Reads OWNER_EMAIL, OWNER_PASSWORD, OWNER_NAME from the environment. */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const db = require("./db");
const A = require("./auth");

(async function () {
  const email = String(process.env.OWNER_EMAIL || "").trim().toLowerCase();
  const password = String(process.env.OWNER_PASSWORD || "");
  const name = String(process.env.OWNER_NAME || "Shop owner").trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { console.error("OWNER_EMAIL is missing or invalid"); process.exit(1); }
  if (password.length < 8) { console.error("OWNER_PASSWORD must be at least 8 characters"); process.exit(1); }
  db.configure(process.env.DATABASE_URL);

  const found = await db.query("SELECT id, role FROM users WHERE lower(email) = lower($1)", [email]);
  if (found.length) {
    await db.query("UPDATE users SET password_hash = $1, role = 'owner', active = TRUE WHERE id = $2",
      [A.hashPassword(password), found[0].id]);
    await db.query("DELETE FROM sessions WHERE user_id = $1", [found[0].id]);
    console.log("owner account refreshed for " + email);
  } else {
    await db.query("INSERT INTO users (email, name, password_hash, role) VALUES ($1,$2,$3,'owner')",
      [email, name, A.hashPassword(password)]);
    console.log("owner account created for " + email);
  }
  await db.close();
})().catch(function (e) { console.error(e.message); process.exit(1); });
