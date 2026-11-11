/* node seed.js - imports the current js/config.js catalogue, reels and shop settings
   into the database. Safe to run twice: it skips anything already stored. */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const db = require("./db");
const S = require("./shop");

function readStaticConfig() {
  const file = path.join(__dirname, "..", "js", "config.js");
  const src = fs.readFileSync(file, "utf8");
  const ctx = {};
  vm.runInNewContext(src + "\n;globalThis.__out = { SHOP, MOMO, MONEY, DELIVERY, PRODUCTS, CATEGORIES, COLOR_SWATCHES, REELS };", ctx);
  return ctx.__out;
}

(async function () {
  if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is required"); process.exit(1); }
  db.configure(process.env.DATABASE_URL);
  const q = db.query;
  const cfg = readStaticConfig();

  const existing = await q("SELECT COUNT(*) AS n FROM products");
  if (Number(existing[0].n) > 0) {
    console.log("products already in the database - catalogue import skipped");
  } else {
    for (let i = 0; i < cfg.PRODUCTS.length; i++) {
      const p = cfg.PRODUCTS[i];
      const ins = await q(
        "INSERT INTO products (sku, name, category, price, image, badge) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
        [p.id, p.name, p.category, Math.round(p.price), p.img, p.badge || ""]
      );
      const id = ins[0].id;
      for (let c = 0; c < (p.colors || []).length; c++) {
        const name = p.colors[c];
        await q("INSERT INTO product_colors (product_id, name, swatch) VALUES ($1,$2,$3)",
          [id, name, (cfg.COLOR_SWATCHES && cfg.COLOR_SWATCHES[name]) || "#d9d9d9"]);
      }
      for (let s = 0; s < (p.sizes || []).length; s++) {
        await q("INSERT INTO product_sizes (product_id, value) VALUES ($1,$2)", [id, p.sizes[s]]);
      }
    }
    console.log("imported " + cfg.PRODUCTS.length + " products with colours and sizes");
  }

  const reels = await q("SELECT COUNT(*) AS n FROM reels");
  if (Number(reels[0].n) > 0) {
    console.log("reels already stored - import skipped");
  } else if (cfg.REELS && cfg.REELS.length) {
    for (let i = 0; i < cfg.REELS.length; i++) {
      const r = cfg.REELS[i];
      await q("INSERT INTO reels (src, poster, title, meta, text, link, link_label, consent) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [r.src, r.poster || "", r.title, r.meta || "", r.text || "", r.link || "product.html", r.linkLabel || "Shop now", r.consent || ""]);
    }
    console.log("imported " + cfg.REELS.length + " reels");
  }

  const pairs = {
    "shop.name": cfg.SHOP.name,
    "shop.whatsapp": cfg.SHOP.whatsappNumber,
    "shop.phoneDisplay": cfg.SHOP.phoneDisplay,
    "shop.email": cfg.SHOP.email,
    "shop.address": cfg.SHOP.addressLine,
    "momo.number": cfg.MOMO.merchantNumber,
    "momo.name": cfg.MOMO.merchantName,
    "momo.network": cfg.MOMO.network,
    "momo.ussd": cfg.MOMO.ussdCode || "",
    "money.currency": cfg.MONEY.currency,
    "delivery.freeOver": String(cfg.DELIVERY.freeOver),
    "delivery.zones": JSON.stringify(cfg.DELIVERY.zones),
  };
  for (const key of Object.keys(pairs)) {
    const found = await q("SELECT key FROM settings WHERE key = $1", [key]);
    if (!found.length) await q("INSERT INTO settings (key, value) VALUES ($1,$2)", [key, String(pairs[key])]);
  }
  console.log("shop settings stored");
  await db.close();
})().catch(function (e) { console.error(e); process.exit(1); });
