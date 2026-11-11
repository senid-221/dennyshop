/* LOCAL STAND-IN ONLY - not for production.
   Runs the same Express app against an in-memory Postgres (pg-mem) so the
   dashboard and the shop can be clicked through on this machine without a
   database. Production uses index.js + DATABASE_URL (Neon). */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { newDb } = require("pg-mem");
const bcrypt = require("bcryptjs");
const { createApp } = require("./app");
const S = require("./shop");

const mem = newDb();
fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8")
  .split("\n").filter(function (l) { return !/^\s*--/.test(l); }).join("\n")
  .split(";").map(function (s) { return s.trim(); }).filter(Boolean)
  .forEach(function (stmt) { mem.public.none(stmt); });

const pool = new (mem.adapters.createPg().Pool)();
const db = {
  query: function (text, params) { return pool.query(text, params).then(function (r) { return r.rows; }); },
  tx: function (fn) { return fn({ query: db.query }); },
};

const cfg = vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "js", "config.js"), "utf8") +
  "\n;({SHOP, MOMO, MONEY, DELIVERY, PRODUCTS, COLOR_SWATCHES, REELS})", {});

(async function () {
  await S.upsertSettings(db);
  for (const p of cfg.PRODUCTS) {
    const ins = await db.query("INSERT INTO products (sku,name,category,price,image,badge) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
      [p.id, p.name, p.category, p.price, p.img, p.badge || ""]);
    for (const c of (p.colors || [])) {
      await db.query("INSERT INTO product_colors (product_id,name,swatch) VALUES ($1,$2,$3)",
        [ins[0].id, c, cfg.COLOR_SWATCHES[c] || "#d9d9d9"]);
    }
    for (const s of (p.sizes || [])) {
      await db.query("INSERT INTO product_sizes (product_id,value) VALUES ($1,$2)", [ins[0].id, s]);
    }
  }
  for (const r of (cfg.REELS || [])) {
    await db.query("INSERT INTO reels (src,poster,title,meta,text,link,link_label,consent) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [r.src, r.poster, r.title, r.meta, r.text, r.link, r.linkLabel, r.consent]);
  }
  await db.query("INSERT INTO users (email,name,password_hash,role) VALUES ($1,$2,$3,'owner')",
    ["owner@denny.rw", "Owner", bcrypt.hashSync("denny12345", 8)]);
  await db.query("INSERT INTO users (email,name,password_hash,role) VALUES ($1,$2,$3,'staff')",
    ["staff@denny.rw", "Store Staff", bcrypt.hashSync("staff12345", 8)]);
  const aff = await db.query("INSERT INTO affiliates (code,name,phone,commission_pct) VALUES ('eric','Eric Nshuti','0788111222',12) RETURNING id");
  await db.query("INSERT INTO users (email,name,password_hash,role,affiliate_id) VALUES ($1,$2,$3,'advertiser',$4)",
    ["eric@denny.rw", "Eric Nshuti", bcrypt.hashSync("eric12345", 8), aff[0].id]);

  const app = createApp({
    db: db,
    cfg: { staticDir: path.join(__dirname, ".."), secureCookies: false, siteUrl: "http://127.0.0.1:8130" },
  });
  app.listen(8130, function () {
    console.log("LOCAL STAND-IN (memory only, data resets on restart): http://127.0.0.1:8130");
    console.log("admin: http://127.0.0.1:8130/admin  owner@denny.rw / denny12345");
  });
})().catch(function (e) { console.error(e); process.exit(1); });
