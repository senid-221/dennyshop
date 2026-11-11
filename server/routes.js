/* Page routes, short links, health check, path guard and the 404 handler. */
const path = require("path");
const fs = require("fs");

const PAGES = {
  "/products": "product.html",
  "/shop": "product.html",
  "/reels": "reels.html",
  "/delivery": "contact.html",
  "/payment": "contact.html",
  "/contact": "contact.html",
  "/about": "about.html",
  "/promises": "testimonial.html",
  "/style": "blog_list.html",
};

/* never expose the backend source through the static handler */
const BLOCKED = [/^\/server(\/|$)/i, /^\/node_modules(\/|$)/i, /^\/\.git(\/|$)/i, /^\/admin\/admin\.js\.map$/i];

function applyRoutes(app, ctx) {
  const db = ctx.db;

  app.get("/api/health", async function (req, res) {
    const out = { ok: true, app: "dennyshop", time: new Date().toISOString() };
    if (req.query.db === "1") {
      try {
        const rows = await db.query("SELECT 1 AS ok");
        out.db = rows && rows.length ? "up" : "odd";
      } catch (e) {
        out.db = "down";
        out.dbError = e.message;
        res.status(503).json(out);
        return;
      }
    }
    res.json(out);
  });

  /* /r/eric -> storefront with the code attached, and the click counted */
  app.get(/^\/r\/([A-Za-z0-9_-]{2,40})$/, async function (req, res) {
    const code = decodeURIComponent(req.params[0] || "").toLowerCase();
    try {
      const found = await db.query("SELECT id, code, active FROM affiliates WHERE lower(code) = lower($1)", [code]);
      if (found.length && found[0].active) {
        await db.query("INSERT INTO referral_clicks (code, path) VALUES ($1, $2)", [found[0].code, "/r/" + code]);
        return res.redirect(302, "/?ref=" + encodeURIComponent(found[0].code));
      }
    } catch (e) { /* a broken link should not throw a 500 at a shopper */ }
    res.status(404).send(notFoundHtml("That advertiser link is no longer active."));
  });

  Object.keys(PAGES).forEach(function (route) {
    app.get(route, function (req, res) {
      const file = path.join(ctx.cfg.staticDir || "", PAGES[route]);
      if (!fs.existsSync(file)) return res.status(404).send(notFoundHtml());
      res.type("html").sendFile(file);
    });
  });
}

function applyGuard(app) {
  app.use(function (req, res, next) {
    const url = req.path || req.url || "";
    if (BLOCKED.some(function (re) { return re.test(url); })) {
      if (/^\/api\//.test(url)) return res.status(404).json({ error: "Not found" });
      return res.status(404).send(notFoundHtml());
    }
    next();
  });
}

function applyFallback(app) {
  app.use(function (req, res) {
    if (/^\/api\//.test(req.path)) return res.status(404).json({ error: "No such endpoint" });
    res.status(404).send(notFoundHtml());
  });

  /* keep a stack trace out of the shopper's browser */
  app.use(function (err, req, res, next) { // eslint-disable-line no-unused-vars
    console.error(err);
    if (/^\/api\//.test(req.path)) return res.status(500).json({ error: "The shop hit a problem. Try again." });
    res.status(500).send(notFoundHtml("The shop hit a problem. Go back and try again."));
  });
}

function notFoundHtml(msg) {
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"><title>Page not found - Denny Shop</title>' +
    '<style>body{font-family:Segoe UI,Roboto,Arial,sans-serif;background:#f7f8f9;color:#131313;display:flex;' +
    'min-height:100vh;align-items:center;justify-content:center;margin:0;text-align:center}' +
    '.box{padding:30px 20px}h1{font-size:42px;margin:0 0 6px;color:#002c3e}p{color:#666;font-size:14px;margin:0 0 20px}' +
    'a{display:inline-block;background:#f7444e;color:#fff;text-decoration:none;border-radius:999px;padding:11px 22px;' +
    'font-size:13px;font-weight:700;text-transform:uppercase}</style></head><body><div class="box">' +
    '<h1>404</h1><p>' + (msg || "We could not find that page.") + '</p>' +
    '<a href="/index.html">Back to the shop</a></div></body></html>';
}

module.exports = { applyRoutes, applyGuard, applyFallback, PAGES };
