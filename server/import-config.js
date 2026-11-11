/* Imports the storefront catalogue, reels and shop settings from js/config.js
   into the database. Idempotent: anything already stored is left alone, so
   dashboard edits are never overwritten. */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const S = require("./shop");

function readConfig(repoRoot) {
  const sandbox = vm.createContext({});
  const src = fs.readFileSync(path.join(repoRoot, "js", "config.js"), "utf8") +
    "\n;__out = { SHOP: SHOP, MOMO: MOMO, MONEY: MONEY, DELIVERY: DELIVERY, PRODUCTS: PRODUCTS, COLOR_SWATCHES: (typeof COLOR_SWATCHES !== 'undefined' ? COLOR_SWATCHES : {}), REELS: (typeof REELS !== 'undefined' ? REELS : []) };";
  vm.runInContext(src, sandbox);
  return sandbox.__out;
}

async function importAll(db, repoRoot) {
  const cfg = readConfig(repoRoot);
  const report = { products: 0, reels: 0, settings: 0, skippedProducts: false };

  const existing = await db.query("SELECT COUNT(*) AS n FROM products");
  if (Number(existing[0].n) > 0) {
    report.skippedProducts = true;
  } else {
    for (const p of cfg.PRODUCTS) {
      const ins = await db.query(
        "INSERT INTO products (sku,name,category,price,image,badge) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
        [p.id, p.name, p.category, Math.round(Number(p.price)), p.img, p.badge || ""]);
      const id = ins[0].id;
      for (const name of (p.colors || [])) {
        await db.query("INSERT INTO product_colors (product_id,name,swatch) VALUES ($1,$2,$3)",
          [id, name, (cfg.COLOR_SWATCHES && cfg.COLOR_SWATCHES[name]) || "#d9d9d9"]);
      }
      for (const size of (p.sizes || [])) {
        await db.query("INSERT INTO product_sizes (product_id,value) VALUES ($1,$2)", [id, size]);
      }
      report.products++;
    }
  }

  const reels = await db.query("SELECT COUNT(*) AS n FROM reels");
  if (Number(reels[0].n) === 0) {
    for (const r of (cfg.REELS || [])) {
      await db.query(
        "INSERT INTO reels (src,poster,title,meta,text,link,link_label,consent) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [r.src, r.poster || "", r.title, r.meta || "", r.text || "", r.link || "/product",
          r.linkLabel || "Shop now", r.consent || "Product photos only - no people."]);
      report.reels++;
    }
  }

  await S.upsertSettings(db);
  const pairs = {
    "shop.name": cfg.SHOP.name, "shop.whatsapp": cfg.SHOP.whatsappNumber,
    "shop.phoneDisplay": cfg.SHOP.phoneDisplay, "shop.email": cfg.SHOP.email,
    "shop.address": cfg.SHOP.addressLine, "momo.number": cfg.MOMO.merchantNumber,
    "momo.name": cfg.MOMO.merchantName, "momo.network": cfg.MOMO.network,
    "momo.ussd": cfg.MOMO.ussdCode || "", "money.currency": cfg.MONEY.currency,
    "delivery.freeOver": String(cfg.DELIVERY.freeOver), "delivery.zones": JSON.stringify(cfg.DELIVERY.zones),
  };
  for (const key of Object.keys(pairs)) {
    const found = await db.query("SELECT key, value FROM settings WHERE key = $1", [key]);
    if (!found.length) {
      await db.query("INSERT INTO settings (key, value) VALUES ($1,$2)", [key, String(pairs[key])]);
      report.settings++;
    }
  }
  return report;
}

module.exports = { importAll, readConfig };
