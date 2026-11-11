/* node make-owner.js - creates the one owner account from your environment.
   Nothing is created without OWNER_EMAIL and a real OWNER_PASSWORD. */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const db = require("./db");
const A = require("./auth");

const WEAK = ["change-me", "changeme", "password", "denny12345", "owner12345", "12345678", "admin12345"];

(async function () {
  const email = String(process.env.OWNER_EMAIL || "").trim().toLowerCase();
  const password = String(process.env.OWNER_PASSWORD || "");
  const name = String(process.env.OWNER_NAME || "Shop owner").trim();

  if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is missing"); process.exit(1); }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error("Set OWNER_EMAIL in server/.env to the address you will sign in with.");
    process.exit(1);
  }
  if (password.length < 10) { console.error("OWNER_PASSWORD must be at least 10 characters."); process.exit(1); }
  if (WEAK.some(function (w) { return password.toLowerCase().indexOf(w) !== -1; })) {
    console.error("OWNER_PASSWORD looks like a sample value. Choose a private one.");
    process.exit(1);
  }
  if (email === "owner@example.com") { console.error("OWNER_EMAIL is still the example address."); process.exit(1); }

  db.configure(process.env.DATABASE_URL);
  const found = await db.query("SELECT id, role FROM users WHERE lower(email) = lower($1)", [email]);
  if (found.length) {
    await db.query("UPDATE users SET password_hash = $1, role = 'owner', active = TRUE WHERE id = $2",
      [A.hashPassword(password), found[0].id]);
    await db.query("DELETE FROM sessions WHERE user_id = $1", [found[0].id]);
    console.log("owner password refreshed for " + email);
  } else {
    await db.query("INSERT INTO users (email,name,password_hash,role) VALUES ($1,$2,$3,'owner')",
      [email, name, A.hashPassword(password)]);
    console.log("owner account created for " + email);
  }
  console.log("Sign in at /admin with that email, then add staff or advertisers under Team.");
  await db.close();
})().catch(function (e) { console.error(e.message || e); process.exit(1); });
