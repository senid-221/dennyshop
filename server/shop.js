/* Shop rules: settings, catalogue, money and order creation.
   Prices always come from the database, never from the browser. */

const DEFAULT_SETTINGS = {
  "shop.name": "Denny Shop",
  "shop.whatsapp": "250783600961",
  "shop.phoneDisplay": "+250 783 600 961",
  "shop.email": "info@dennyshop.com",
  "shop.address": "Muhanga - Rwanda",
  "momo.number": "935237",
  "momo.name": "DENNY SHOP",
  "momo.network": "MTN MoMo Pay",
  "momo.ussd": "",
  "money.currency": "RWF",
  "delivery.freeOver": "200000",
  "delivery.zones": '[{"name":"Muhanga","fee":1500},{"name":"Kigali City","fee":2000},{"name":"Other district","fee":3500}]',
};

const ORDER_STATUSES = ["new", "paid", "confirmed", "delivered", "cancelled"];
const EARNED_STATUSES = ["confirmed", "delivered"];

async function getSettings(db) {
  const rows = await db.query("SELECT key, value FROM settings");
  const map = {};
  rows.forEach(function (r) { map[r.key] = r.value; });
  Object.keys(DEFAULT_SETTINGS).forEach(function (k) {
    if (map[k] === undefined || map[k] === "") map[k] = DEFAULT_SETTINGS[k];
  });
  return map;
}

function zonesFrom(settings) {
  try {
    const z = JSON.parse(settings["delivery.zones"]);
    return Array.isArray(z) && z.length ? z : [];
  } catch (e) {
    return [];
  }
}

async function loadCatalog(db, opts) {
  const includeHidden = opts && opts.includeHidden;
  const products = await db.query(
    "SELECT id, sku, name, category, price, image, badge, active FROM products" +
    (includeHidden ? "" : " WHERE active = TRUE") + " ORDER BY id"
  );
  const colors = await db.query("SELECT product_id, name, swatch FROM product_colors ORDER BY id");
  const sizes = await db.query("SELECT product_id, value FROM product_sizes ORDER BY id");
  const byId = {};
  products.forEach(function (p) {
    byId[p.id] = {
      id: p.id, sku: p.sku, name: p.name, category: p.category,
      price: Number(p.price), img: p.image, badge: p.badge || "",
      colors: [], sizes: [], active: p.active,
    };
  });
  colors.forEach(function (c) { if (byId[c.product_id]) byId[c.product_id].colors.push({ name: c.name, swatch: c.swatch }); });
  sizes.forEach(function (s) { if (byId[s.product_id]) byId[s.product_id].sizes.push(s.value); });
  return Object.keys(byId).map(function (k) { return byId[k]; });
}

async function loadReels(db, includeHidden) {
  return await db.query("SELECT id, src, poster, title, meta, text, link, link_label, consent, active FROM reels" +
    (includeHidden ? "" : " WHERE active = TRUE") + " ORDER BY id");
}

function deliveryFee(settings, zone, subtotal) {
  const freeOver = Number(settings["delivery.freeOver"]) || 0;
  if (subtotal >= freeOver) return 0;
  const zones = zonesFrom(settings);
  for (let i = 0; i < zones.length; i++) {
    if (zones[i].name === zone) return Number(zones[i].fee) || 0;
  }
  return zones.length ? Number(zones[zones.length - 1].fee) || 0 : 0;
}

function orderCode() {
  const d = new Date();
  const p = function (n) { return String(n).length < 2 ? "0" + n : String(n); };
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return "DEN-" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + rand;
}

/* Validates the cart against the database and returns the priced lines. */
async function priceOrder(db, settings, items, zone) {
  if (!Array.isArray(items) || !items.length) {
    const e = new Error("Your cart is empty"); e.status = 400; throw e;
  }
  if (items.length > 50) { const e = new Error("Too many lines"); e.status = 400; throw e; }
  const catalog = {};
  (await loadCatalog(db, { includeHidden: false })).forEach(function (p) { catalog[p.id] = p; });

  const lines = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i] || {};
    const id = Number(it.id);
    const p = catalog[id];
    if (!p) { const e = new Error("Item " + id + " is no longer in the shop"); e.status = 400; throw e; }
    const qty = Math.floor(Number(it.qty));
    if (!(qty >= 1 && qty <= 20)) { const e = new Error("Quantity must be between 1 and 20"); e.status = 400; throw e; }
    const size = String(it.size || "").slice(0, 20);
    const color = String(it.color || "").slice(0, 40);
    if (!p.sizes.length || p.sizes.indexOf(size) === -1) {
      const e = new Error("Choose a real size for " + p.name); e.status = 400; throw e;
    }
    if (!p.colors.length || p.colors.map(function (c) { return c.name; }).indexOf(color) === -1) {
      const e = new Error("Choose a real colour for " + p.name); e.status = 400; throw e;
    }
    lines.push({ product_id: p.id, product_name: p.name, size: size, color: color, qty: qty, unit_price: p.price });
  }
  const subtotal = lines.reduce(function (n, l) { return n + l.unit_price * l.qty; }, 0);
  const fee = deliveryFee(settings, zone, subtotal);
  return { lines: lines, subtotal: subtotal, delivery_fee: fee, total: subtotal + fee };
}

function cleanText(v, max) {
  return String(v == null ? "" : v).replace(/[\r\n]+/g, " ").trim().slice(0, max || 200);
}

function normalizePhone(raw) {
  let d = String(raw || "").replace(/[^\d]/g, "");
  if (d.indexOf("00250") === 0) d = d.slice(5);
  else if (d.indexOf("250") === 0 && d.length > 9) d = d.slice(3);
  else if (d.charAt(0) === "0") d = d.slice(1);
  if (d.length === 8 && /^[78]/.test(d)) return "250" + d;
  if (/^[78]\d{8}$/.test(d)) return "250" + d;
  return null;
}

async function createOrder(db, input) {
  const settings = await getSettings(db);
  const name = cleanText(input.name, 120);
  const phone = normalizePhone(input.phone);
  const district = cleanText(input.district, 80);
  const mapUrl = cleanText(input.mapUrl, 300);
  const momoRef = cleanText(input.momoRef, 80);
  const errors = [];
  if (name.length < 3) errors.push("Enter your full name");
  if (!phone) errors.push("Enter a Rwandan mobile number");
  if (!district && !mapUrl) errors.push("Share your location or type the district");
  if (momoRef.replace(/\s+/g, "").length < 6) errors.push("Enter the MoMo transaction reference");
  if (!input.paid) errors.push("Confirm that the MoMo payment was sent");
  if (errors.length) { const e = new Error(errors.join(". ")); e.status = 422; e.fields = errors; throw e; }

  const zone = cleanText(input.zone, 60) || zonesFrom(settings)[0].name;
  const priced = await priceOrder(db, settings, input.items, zone);
  const code = orderCode();

  const affiliate = cleanText(input.affiliateCode, 40).toLowerCase();
  let affiliateRow = null;
  if (affiliate) {
    const found = await db.query("SELECT id, code, commission_pct, active FROM affiliates WHERE lower(code) = lower($1)", [affiliate]);
    if (found.length && found[0].active) affiliateRow = found[0];
  }

  const order = {
    code: code,
    customer_name: name,
    customer_phone: phone,
    customer_email: cleanText(input.email, 160),
    district: district,
    sector: cleanText(input.sector, 80),
    landmark: cleanText(input.landmark, 160),
    map_url: mapUrl,
    zone: zone,
    subtotal: priced.subtotal,
    delivery_fee: priced.delivery_fee,
    total: priced.total,
    momo_number: settings["momo.number"],
    momo_ref: momoRef,
    paid_claimed: !!input.paid,
    notes: cleanText(input.notes, 500),
    affiliate_code: affiliateRow ? affiliateRow.code : "",
    source: "web",
  };

  const inserted = await db.query(
    "INSERT INTO orders (code, status, customer_name, customer_phone, customer_email, district, sector, landmark, map_url, zone, subtotal, delivery_fee, total, momo_number, momo_ref, paid_claimed, notes, affiliate_code, source) " +
    "VALUES ($1,'new',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id, code, created_at",
    [order.code, order.customer_name, order.customer_phone, order.customer_email, order.district, order.sector,
      order.landmark, order.map_url, order.zone, order.subtotal, order.delivery_fee, order.total, order.momo_number,
      order.momo_ref, order.paid_claimed, order.notes, order.affiliate_code, order.source]
  );
  const orderId = inserted[0].id;
  for (let i = 0; i < priced.lines.length; i++) {
    const l = priced.lines[i];
    await db.query(
      "INSERT INTO order_items (order_id, product_id, product_name, size, color, qty, unit_price) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [orderId, l.product_id, l.product_name, l.size, l.color, l.qty, l.unit_price]
    );
  }
  if (affiliateRow) {
    await db.query("UPDATE orders SET affiliate_code = $1 WHERE id = $2", [affiliateRow.code, orderId]);
  }
  return {
    id: orderId, code: inserted[0].code, created_at: inserted[0].created_at,
    subtotal: priced.subtotal, delivery_fee: priced.delivery_fee, total: priced.total,
    lines: priced.lines, affiliate_code: order.affiliate_code,
    commission_pct: affiliateRow ? Number(affiliateRow.commission_pct) : 0,
    momo_number: settings["momo.number"], momo_name: settings["momo.name"],
  };
}

function commission(items, pct) {
  const goods = items.reduce(function (n, l) { return n + l.unit_price * l.qty; }, 0);
  return Math.round(goods * (Number(pct) || 0)) / 100;
}

async function upsertSettings(db) {
  const keys = Object.keys(DEFAULT_SETTINGS);
  for (let i = 0; i < keys.length; i++) {
    const found = await db.query("SELECT key FROM settings WHERE key = $1", [keys[i]]);
    if (!found.length) {
      await db.query("INSERT INTO settings (key, value) VALUES ($1, $2)", [keys[i], DEFAULT_SETTINGS[keys[i]]]);
    }
  }
}

module.exports = {
  DEFAULT_SETTINGS, ORDER_STATUSES, EARNED_STATUSES,
  getSettings, upsertSettings, zonesFrom, loadCatalog, loadReels, deliveryFee, orderCode,
  priceOrder, createOrder, normalizePhone, cleanText, commission,
};
