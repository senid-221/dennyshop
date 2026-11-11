/* Express app factory. createApp({ db, cfg }) so tests can inject pg-mem. */
const express = require("express");
const path = require("path");
const S = require("./shop");
const A = require("./auth");
const R = require("./routes");

function bad(res, msg, status) { return res.status(status || 400).json({ error: msg }); }

/* hex, a plain word, or a CSS gradient - nothing that can inject markup */
const SWATCH_RE = /^(#[0-9a-f]{3,8}|[a-z]+|repeating-linear-gradient\(.*\))$/i;

function wrap(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(function (e) {
      const status = e.status || 500;
      if (status >= 500) {
        console.error(e);
        return res.status(500).json({ error: "The shop could not reach its data. Try again." });
      }
      res.status(status).json({ error: e.message || "Server error" });
    });
  };
}

function createApp(opts) {
  const db = opts.db;
  const cfg = Object.assign({ staticDir: path.join(__dirname, ".."), secureCookies: false, siteUrl: "" }, opts.cfg || {});
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));
  app.use(A.attachUser(db));
  R.applyGuard(app);

  /* ---------------- auth ---------------- */
  app.post("/api/auth/login", wrap(async function (req, res) {
    const email = S.cleanText(req.body.email, 160).toLowerCase();
    const password = String(req.body.password || "");
    const rows = await db.query("SELECT * FROM users WHERE lower(email) = lower($1)", [email]);
    if (!rows.length || !A.checkPassword(password, rows[0].password_hash)) {
      return bad(res, "Email or password is wrong", 401);
    }
    if (!rows[0].active) return bad(res, "This account is disabled", 403);
    const token = await A.createSession(db, rows[0].id);
    A.setSessionCookie(res, token, cfg);
    res.json({ id: rows[0].id, email: rows[0].email, name: rows[0].name, role: rows[0].role });
  }));

  app.post("/api/auth/logout", wrap(async function (req, res) {
    const token = A.parseCookies(req.headers.cookie)[A.COOKIE];
    if (token) await db.query("DELETE FROM sessions WHERE token = $1", [token]);
    A.clearSessionCookie(res, cfg);
    res.json({ ok: true });
  }));

  app.get("/api/auth/me", wrap(async function (req, res) {
    if (!req.user) return res.json({ user: null });
    res.json({
      user: { id: req.user.id, email: req.user.email, name: req.user.name, role: req.user.role },
      affiliate: req.user.affiliate_id ? { code: req.user.affiliate_code, commission_pct: Number(req.user.commission_pct) } : null,
    });
  }));

  /* ---------------- public shop data ---------------- */
  app.get("/api/shop", wrap(async function (req, res) {
    const settings = await S.getSettings(db);
    const products = await S.loadCatalog(db);
    const reels = await S.loadReels(db);
    res.json({
      shop: {
        name: settings["shop.name"], whatsappNumber: settings["shop.whatsapp"],
        phoneDisplay: settings["shop.phoneDisplay"], email: settings["shop.email"],
        addressLine: settings["shop.address"],
      },
      momo: {
        merchantNumber: settings["momo.number"], merchantName: settings["momo.name"],
        network: settings["momo.network"], ussdCode: settings["momo.ussd"],
      },
      money: { currency: settings["money.currency"] },
      delivery: { freeOver: Number(settings["delivery.freeOver"]) || 0, zones: S.zonesFrom(settings) },
      products: products,
      reels: reels,
    });
  }));

  app.post("/api/orders", wrap(async function (req, res) {
    const order = await S.createOrder(db, req.body || {});
    res.status(201).json(order);
  }));

  app.post("/api/track", wrap(async function (req, res) {
    const code = S.cleanText(req.body.code, 40).toLowerCase();
    if (!code) return res.json({ ok: false });
    const found = await db.query("SELECT id FROM affiliates WHERE lower(code) = lower($1) AND active = TRUE", [code]);
    if (!found.length) return res.json({ ok: false });
    await db.query("INSERT INTO referral_clicks (code, path) VALUES ($1, $2)", [code, S.cleanText(req.body.path, 200)]);
    res.json({ ok: true });
  }));

  /* ---------------- admin ---------------- */
  const owner = A.requireRole("owner");
  const staff = A.requireRole("owner", "staff");

  app.get("/api/admin/summary", staff, wrap(async function (req, res) {
    const products = await db.query("SELECT COUNT(*) AS n FROM products");
    const orders = await db.query("SELECT status, COUNT(*) AS n FROM orders GROUP BY status");
    const revenue = await db.query("SELECT SUM(total) AS t FROM orders WHERE status IN ('confirmed','delivered')");
    const affiliates = await db.query("SELECT COUNT(*) AS n FROM affiliates");
    const reels = await db.query("SELECT COUNT(*) AS n FROM reels");
    res.json({
      products: Number(products[0].n),
      reels: Number(reels[0].n),
      affiliates: Number(affiliates[0].n),
      orders: orders.map(function (o) { return { status: o.status, n: Number(o.n) }; }),
      earnedTotal: Number(revenue[0].t || 0),
    });
  }));

  app.get("/api/admin/products", staff, wrap(async function (req, res) {
    res.json({ products: await S.loadCatalog(db, { includeHidden: true }) });
  }));

  app.post("/api/admin/products", staff, wrap(async function (req, res) {
    const b = req.body || {};
    const name = S.cleanText(b.name, 120);
    const price = Math.round(Number(b.price));
    const image = S.cleanText(b.image, 300);
    if (name.length < 2) return bad(res, "Product name is too short");
    if (!(price > 0)) return bad(res, "Price must be a positive number in RWF");
    if (!image) return bad(res, "Add an image path like images/p13.png");
    const cat = S.cleanText(b.category, 30) || "men";
    const ins = await db.query(
      "INSERT INTO products (sku, name, category, price, image, badge) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
      [S.cleanText(b.sku, 30) || null, name, cat, price, image, S.cleanText(b.badge, 30)]
    );
    await addColors(db, ins[0].id, b.colors);
    await addSizes(db, ins[0].id, b.sizes);
    res.status(201).json({ id: ins[0].id });
  }));

  app.patch("/api/admin/products/:id", staff, wrap(async function (req, res) {
    const id = Number(req.params.id);
    const b = req.body || {};
    const fields = [];
    const vals = [];
    const put = function (col, val) { fields.push(col + " = $" + (vals.length + 1)); vals.push(val); };
    if (b.name !== undefined) {
      const v = S.cleanText(b.name, 120);
      if (v.length < 2) return bad(res, "Product name is too short");
      put("name", v);
    }
    if (b.price !== undefined) {
      const v = Math.round(Number(b.price));
      if (!(v > 0)) return bad(res, "Price must be a positive number in RWF");
      put("price", v);
    }
    if (b.category !== undefined) put("category", S.cleanText(b.category, 30) || "men");
    if (b.image !== undefined) put("image", S.cleanText(b.image, 300));
    if (b.badge !== undefined) put("badge", S.cleanText(b.badge, 30));
    if (b.sku !== undefined) put("sku", S.cleanText(b.sku, 30) || null);
    if (b.active !== undefined) put("active", !!b.active);
    if (!fields.length) return bad(res, "Nothing to change");
    vals.push(id);
    await db.query("UPDATE products SET " + fields.join(", ") + " WHERE id = $" + vals.length, vals);
    if (Array.isArray(b.colors)) {
      await db.query("DELETE FROM product_colors WHERE product_id = $1", [id]);
      await addColors(db, id, b.colors);
    }
    if (Array.isArray(b.sizes)) {
      await db.query("DELETE FROM product_sizes WHERE product_id = $1", [id]);
      await addSizes(db, id, b.sizes);
    }
    res.json({ ok: true });
  }));

  app.delete("/api/admin/products/:id", owner, wrap(async function (req, res) {
    const id = Number(req.params.id);
    const linked = await db.query("SELECT COUNT(*) AS n FROM order_items WHERE product_id = $1", [id]);
    if (Number(linked[0].n) > 0) {
      await db.query("UPDATE products SET active = FALSE WHERE id = $1", [id]);
      return res.json({ ok: true, hidden: true, note: "This product is on existing orders, so it was hidden instead of deleted." });
    }
    await db.query("DELETE FROM product_colors WHERE product_id = $1", [id]);
    await db.query("DELETE FROM product_sizes WHERE product_id = $1", [id]);
    await db.query("DELETE FROM products WHERE id = $1", [id]);
    res.json({ ok: true, deleted: true });
  }));

  app.post("/api/admin/products/:id/colors", staff, wrap(async function (req, res) {
    const id = Number(req.params.id);
    const p = await db.query("SELECT id FROM products WHERE id = $1", [id]);
    if (!p.length) return bad(res, "No such product", 404);
    const out = await addColors(db, id, [req.body]);
    if (out.error && !out.added.length) return bad(res, out.error);
    res.status(out.added.length ? 201 : 200).json({ added: out.added, skipped: out.skipped });
  }));

  app.delete("/api/admin/colors/:id", staff, wrap(async function (req, res) {
    await db.query("DELETE FROM product_colors WHERE id = $1", [Number(req.params.id)]);
    res.json({ ok: true });
  }));

  app.post("/api/admin/products/:id/sizes", staff, wrap(async function (req, res) {
    const id = Number(req.params.id);
    const p = await db.query("SELECT id FROM products WHERE id = $1", [id]);
    if (!p.length) return bad(res, "No such product", 404);
    const out = await addSizes(db, id, [req.body]);
    if (out.error && !out.added.length) return bad(res, out.error);
    res.status(out.added.length ? 201 : 200).json({ added: out.added, skipped: out.skipped });
  }));

  app.delete("/api/admin/sizes/:id", staff, wrap(async function (req, res) {
    await db.query("DELETE FROM product_sizes WHERE id = $1", [Number(req.params.id)]);
    res.json({ ok: true });
  }));

  app.get("/api/admin/reels", staff, wrap(async function (req, res) {
    res.json({ reels: await S.loadReels(db, true) });
  }));

  app.post("/api/admin/reels", staff, wrap(async function (req, res) {
    const b = req.body || {};
    const src = S.cleanText(b.src, 300);
    const title = S.cleanText(b.title, 120);
    if (!src) return bad(res, "Clip path is required, e.g. reels/clip.mp4");
    if (title.length < 2) return bad(res, "Give the reel a title");
    const ins = await db.query(
      "INSERT INTO reels (src, poster, title, meta, text, link, link_label, consent) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
      [src, S.cleanText(b.poster, 300), title, S.cleanText(b.meta, 160), S.cleanText(b.text, 300),
        S.cleanText(b.link, 200) || "product.html", S.cleanText(b.link_label, 60) || "Shop now",
        S.cleanText(b.consent, 200) || "Product photos only - no people."]
    );
    res.status(201).json({ id: ins[0].id });
  }));

  app.patch("/api/admin/reels/:id", staff, wrap(async function (req, res) {
    const id = Number(req.params.id);
    const b = req.body || {};
    const fields = [];
    const vals = [];
    const put = function (col, val) { fields.push(col + " = $" + (vals.length + 1)); vals.push(val); };
    ["src", "poster", "title", "meta", "text", "link", "link_label", "consent"].forEach(function (k) {
      if (b[k] !== undefined) put(k, S.cleanText(b[k], 300));
    });
    if (b.active !== undefined) put("active", !!b.active);
    if (!fields.length) return bad(res, "Nothing to change");
    vals.push(id);
    await db.query("UPDATE reels SET " + fields.join(", ") + " WHERE id = $" + vals.length, vals);
    res.json({ ok: true });
  }));

  app.delete("/api/admin/reels/:id", staff, wrap(async function (req, res) {
    await db.query("DELETE FROM reels WHERE id = $1", [Number(req.params.id)]);
    res.json({ ok: true });
  }));

  app.get("/api/admin/orders", staff, wrap(async function (req, res) {
    const where = [];
    const vals = [];
    const add = function (clause, v) { where.push(clause); vals.push(v); };
    if (req.query.status && S.ORDER_STATUSES.indexOf(req.query.status) !== -1) add("orders.status = $" + (vals.length + 1), req.query.status);
    if (req.query.affiliate) add("lower(orders.affiliate_code) = lower($" + (vals.length + 1) + ")", S.cleanText(req.query.affiliate, 40));
    if (req.query.q) {
      const q = "%" + S.cleanText(req.query.q, 60) + "%";
      where.push("(lower(orders.customer_name) LIKE lower($" + (vals.length + 1) + ") OR orders.customer_phone LIKE $" + (vals.length + 1) + " OR lower(orders.code) LIKE lower($" + (vals.length + 1) + "))");
      vals.push(q);
    }
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const filter = where.length ? "WHERE " + where.join(" AND ") : "";
    const rows = await db.query(
      "SELECT orders.*, cnt.n AS item_count FROM orders " +
      "LEFT JOIN (SELECT order_items.order_id AS oid, COUNT(*) AS n FROM order_items GROUP BY order_items.order_id) cnt ON cnt.oid = orders.id " +
      filter + " ORDER BY orders.id DESC LIMIT " + limit + " OFFSET " + offset, vals);
    const countRow = await db.query("SELECT COUNT(*) AS n FROM orders " + filter, vals);
    res.json({
      orders: rows.map(function (o) { return Object.assign({}, o, { item_count: Number(o.item_count || 0) }); }),
      total: Number(countRow[0].n),
    });
  }));

  app.get("/api/admin/orders/:id", staff, wrap(async function (req, res) {
    const id = Number(req.params.id);
    const rows = await db.query("SELECT * FROM orders WHERE id = $1", [id]);
    if (!rows.length) return bad(res, "Order not found", 404);
    const items = await db.query("SELECT * FROM order_items WHERE order_id = $1 ORDER BY id", [id]);
    res.json({ order: rows[0], items: items });
  }));

  app.patch("/api/admin/orders/:id", staff, wrap(async function (req, res) {
    const id = Number(req.params.id);
    const status = S.cleanText((req.body || {}).status, 20);
    if (S.ORDER_STATUSES.indexOf(status) === -1) return bad(res, "Status must be one of " + S.ORDER_STATUSES.join(", "));
    const rows = await db.query("UPDATE orders SET status = $1 WHERE id = $2 RETURNING id, code, status", [status, id]);
    if (!rows.length) return bad(res, "Order not found", 404);
    res.json(rows[0]);
  }));

  app.get("/api/admin/affiliates", staff, wrap(async function (req, res) {
    const rows = await db.query("SELECT * FROM affiliates ORDER BY id");
    const clicks = await db.query("SELECT code AS code, COUNT(*) AS n FROM referral_clicks GROUP BY code");
    const clickByCode = {};
    clicks.forEach(function (c) { clickByCode[String(c.code).toLowerCase()] = Number(c.n); });
    const stats = await db.query(
      "SELECT affiliate_code AS code, COUNT(*) AS orders, SUM(total) AS revenue, " +
      "SUM(CASE WHEN status IN ('confirmed','delivered') THEN subtotal ELSE 0 END) AS earned_base " +
      "FROM orders WHERE affiliate_code <> '' GROUP BY affiliate_code"
    );
    const byCode = {};
    stats.forEach(function (s) { byCode[String(s.code).toLowerCase()] = s; });
    res.json({
      affiliates: rows.map(function (a) {
        const s = byCode[String(a.code).toLowerCase()] || { orders: 0, revenue: 0 };
        const earned = earnedOn(s, a.commission_pct);
        return Object.assign({}, a, {
          commission_pct: Number(a.commission_pct),
          order_count: Number(s.orders),
          clicks: clickByCode[String(a.code).toLowerCase()] || 0,
          revenue: Number(s.revenue || 0),
          earned: earned,
        });
      }),
    });
  }));

  app.post("/api/admin/affiliates", owner, wrap(async function (req, res) {
    const b = req.body || {};
    const code = S.cleanText(b.code, 40).toLowerCase().replace(/[^a-z0-9_-]/g, "");
    const name = S.cleanText(b.name, 120);
    const pct = Number(b.commission_pct);
    if (code.length < 2) return bad(res, "Link code needs at least 2 letters or numbers");
    if (name.length < 2) return bad(res, "Advertiser name is required");
    if (!(pct >= 0 && pct <= 60)) return bad(res, "Commission must be between 0 and 60 percent");
    const clash = await db.query("SELECT id FROM affiliates WHERE lower(code) = lower($1)", [code]);
    if (clash.length) return bad(res, "That code is already taken");
    const ins = await db.query(
      "INSERT INTO affiliates (code, name, phone, commission_pct) VALUES ($1,$2,$3,$4) RETURNING id, code",
      [code, name, S.cleanText(b.phone, 40), Math.round(pct * 100) / 100]
    );
    let userId = null;
    if (b.email && b.password) {
      const created = await createUser(db, {
        email: b.email, name: name, password: b.password, role: "advertiser", affiliate_id: ins[0].id,
      });
      userId = created.id;
    }
    res.status(201).json({ id: ins[0].id, code: ins[0].code, user_id: userId });
  }));

  app.patch("/api/admin/affiliates/:id", owner, wrap(async function (req, res) {
    const id = Number(req.params.id);
    const b = req.body || {};
    const fields = [];
    const vals = [];
    const put = function (col, val) { fields.push(col + " = $" + (vals.length + 1)); vals.push(val); };
    if (b.name !== undefined) {
      const v = S.cleanText(b.name, 120);
      if (v.length < 2) return bad(res, "Advertiser name is required");
      put("name", v);
    }
    if (b.phone !== undefined) put("phone", S.cleanText(b.phone, 40));
    if (b.commission_pct !== undefined) {
      const v = Number(b.commission_pct);
      if (!(v >= 0 && v <= 60)) return bad(res, "Commission must be between 0 and 60 percent");
      put("commission_pct", Math.round(v * 100) / 100);
    }
    if (b.active !== undefined) put("active", !!b.active);
    if (!fields.length) return bad(res, "Nothing to change");
    vals.push(id);
    const rows = await db.query("UPDATE affiliates SET " + fields.join(", ") + " WHERE id = $" + vals.length + " RETURNING id", vals);
    if (!rows.length) return bad(res, "Advertiser not found", 404);
    res.json({ ok: true });
  }));

  app.get("/api/admin/users", owner, wrap(async function (req, res) {
    const rows = await db.query(
      "SELECT u.id, u.email, u.name, u.role, u.active, u.affiliate_id, a.code AS affiliate_code " +
      "FROM users u LEFT JOIN affiliates a ON a.id = u.affiliate_id ORDER BY u.id"
    );
    res.json({ users: rows });
  }));

  app.post("/api/admin/users", owner, wrap(async function (req, res) {
    const b = req.body || {};
    if (["owner", "staff", "advertiser"].indexOf(b.role) === -1) return bad(res, "Role must be owner, staff or advertiser");
    if (b.role === "advertiser" && !b.affiliate_id) return bad(res, "Pick an advertiser link code for this account");
    const created = await createUser(db, b);
    res.status(201).json(created);
  }));

  app.patch("/api/admin/users/:id", owner, wrap(async function (req, res) {
    const id = Number(req.params.id);
    const b = req.body || {};
    if (b.password) {
      if (String(b.password).length < 8) return bad(res, "Password needs at least 8 characters");
      await db.query("UPDATE users SET password_hash = $1 WHERE id = $2", [A.hashPassword(b.password), id]);
      await db.query("DELETE FROM sessions WHERE user_id = $1", [id]);
    }
    if (b.role !== undefined) {
      if (["owner", "staff", "advertiser"].indexOf(b.role) === -1) return bad(res, "Role must be owner, staff or advertiser");
      await db.query("UPDATE users SET role = $1 WHERE id = $2", [b.role, id]);
    }
    if (b.active !== undefined) await db.query("UPDATE users SET active = $1 WHERE id = $2", [!!b.active, id]);
    res.json({ ok: true });
  }));

  app.get("/api/admin/settings", staff, wrap(async function (req, res) {
    res.json({ settings: await S.getSettings(db) });
  }));

  app.put("/api/admin/settings", owner, wrap(async function (req, res) {
    const b = req.body || {};
    const allowed = Object.keys(S.DEFAULT_SETTINGS);
    const keys = Object.keys(b);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (allowed.indexOf(k) === -1) continue;
      let v = String(b[k] == null ? "" : b[k]);
      if (k === "shop.whatsapp") {
        const digits = v.replace(/[^\d]/g, "").replace(/^\+/, "");
        if (!/^250[78]\d{8}$/.test(digits) && !/^0[78]\d{8}$/.test(digits) && !/^250[78]\d{7}$/.test(digits)) {
          return bad(res, "WhatsApp number must be a Rwandan number like 250788123456");
        }
        v = digits.replace(/^0/, "250");
      }
      if (k === "delivery.zones") {
        try {
          const zones = JSON.parse(v);
          if (!Array.isArray(zones) || !zones.length) return bad(res, "Delivery zones must be a list");
          zones.forEach(function (z) {
            if (!z.name || !(Number(z.fee) >= 0)) throw new Error("each zone needs a name and a fee");
          });
          v = JSON.stringify(zones);
        } catch (e) { return bad(res, "Delivery zones are not valid JSON: " + e.message); }
      }
      if (k === "money.currency" && !/^[A-Z]{3}$/.test(v)) return bad(res, "Currency must be 3 letters, e.g. RWF");
      const found = await db.query("SELECT key FROM settings WHERE key = $1", [k]);
      if (found.length) await db.query("UPDATE settings SET value = $1 WHERE key = $2", [v, k]);
      else await db.query("INSERT INTO settings (key, value) VALUES ($1, $2)", [k, v]);
    }
    res.json({ settings: await S.getSettings(db) });
  }));

  /* ---------------- advertiser self service ---------------- */
  app.get("/api/affiliate/me", A.requireRole("advertiser", "owner"), wrap(async function (req, res) {
    const code = req.user.role === "owner" && req.query.code
      ? S.cleanText(req.query.code, 40) : req.user.affiliate_code;
    if (!code) return bad(res, "This account has no advertiser code yet", 400);
    const aff = await db.query("SELECT * FROM affiliates WHERE lower(code) = lower($1)", [code]);
    if (!aff.length) return bad(res, "Advertiser not found", 404);
    const a = aff[0];
    const orders = await db.query(
      "SELECT o.id, o.code, o.status, o.total, o.subtotal, o.created_at, o.customer_name FROM orders o " +
      "WHERE lower(o.affiliate_code) = lower($1) ORDER BY o.id DESC LIMIT 100", [a.code]
    );
    const sums = await db.query(
      "SELECT SUM(CASE WHEN o.status IN ('confirmed','delivered') THEN o.subtotal ELSE 0 END) AS earned_base, " +
      "COUNT(*) AS all_orders FROM orders o WHERE lower(o.affiliate_code) = lower($1)", [a.code]
    );
    const base = Number(sums[0].earned_base || 0);
    res.json({
      code: a.code, name: a.name, commission_pct: Number(a.commission_pct),
      link: cfg.siteUrl + "/r/" + a.code,
      order_count: orders.length,
      referred_orders: Number(sums[0].all_orders || 0),
      earned_goods_value: base,
      earned_commission: Math.round(base * Number(a.commission_pct)) / 100,
      orders: orders,
    });
  }));

  /* ---------------- clean page routes ---------------- */
  R.applyRoutes(app, { db: db, cfg: cfg });

  /* ---------------- static site and admin UI ---------------- */
  app.use("/admin", express.static(path.join(__dirname, "..", "admin")));
  if (cfg.staticDir) app.use(express.static(cfg.staticDir, { index: ["index.html"], extensions: ["html"] }));
  R.applyFallback(app);

  return app;
}

async function addColors(db, productId, list) {
  const added = [];
  let skipped = 0;
  let error = "";
  const rows = await db.query("SELECT name FROM product_colors WHERE product_id = $1", [productId]);
  const existing = rows.map(function (r) { return String(r.name).toLowerCase(); });
  const arr = Array.isArray(list) ? list : [list];
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i] || {};
    const name = S.cleanText(typeof item === "string" ? item : item.name, 40);
    if (name.length < 2) { error = "Colour name is required (at least 2 letters)"; continue; }
    if (existing.indexOf(name.toLowerCase()) !== -1) { skipped++; continue; }
    const swatch = S.cleanText(typeof item === "string" ? "" : item.swatch, 60) || "#d9d9d9";
    if (!SWATCH_RE.test(swatch)) { error = "Swatch must be a colour like #1e5aa8 or a word"; continue; }
    await db.query("INSERT INTO product_colors (product_id, name, swatch) VALUES ($1,$2,$3)", [productId, name, swatch]);
    existing.push(name.toLowerCase());
    added.push({ name: name, swatch: swatch });
  }
  return { added: added, skipped: skipped, error: error };
}

async function addSizes(db, productId, list) {
  const added = [];
  let skipped = 0;
  let error = "";
  const rows = await db.query("SELECT value FROM product_sizes WHERE product_id = $1", [productId]);
  const existing = rows.map(function (r) { return String(r.value).toLowerCase(); });
  const arr = Array.isArray(list) ? list : [list];
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i] || {};
    const value = S.cleanText(typeof item === "string" ? item : item.value, 20);
    if (!value) { error = "Size value is required"; continue; }
    if (existing.indexOf(value.toLowerCase()) !== -1) { skipped++; continue; }
    await db.query("INSERT INTO product_sizes (product_id, value) VALUES ($1,$2)", [productId, value]);
    existing.push(value.toLowerCase());
    added.push(value);
  }
  return { added: added, skipped: skipped, error: error };
}

async function createUser(db, b) {
  const email = S.cleanText(b.email, 160).toLowerCase();
  const name = S.cleanText(b.name, 120);
  const password = String(b.password || "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { const e = new Error("Enter a valid email"); e.status = 400; throw e; }
  if (name.length < 2) { const e = new Error("Enter the person's name"); e.status = 400; throw e; }
  if (password.length < 8) { const e = new Error("Password needs at least 8 characters"); e.status = 400; throw e; }
  const clash = await db.query("SELECT id FROM users WHERE lower(email) = lower($1)", [email]);
  if (clash.length) { const e = new Error("That email already has an account"); e.status = 409; throw e; }
  const ins = await db.query(
    "INSERT INTO users (email, name, password_hash, role, affiliate_id) VALUES ($1,$2,$3,$4,$5) RETURNING id, email, name, role",
    [email, name, require("./auth").hashPassword(password), b.role || "staff", b.affiliate_id || null]
  );
  return ins[0];
}

function earnedOn(sumRow, pct) {
  return Math.round(Number(sumRow.earned_base || 0) * Number(pct)) / 100;
}

module.exports = { createApp };
