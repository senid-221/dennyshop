/* API tests against an in-memory Postgres (pg-mem), so they run anywhere.
   node --test test/ */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const request = require("supertest");
const { newDb } = require("pg-mem");
const bcrypt = require("bcryptjs");

const { createApp } = require("../app");
const S = require("../shop");

function makeDb() {
  const mem = newDb();
  const schema = fs.readFileSync(path.join(__dirname, "..", "schema.sql"), "utf8")
    .split("\n").filter(function (l) { return !/^\s*--/.test(l); }).join("\n");
  schema.split(";").map(function (s) { return s.trim(); }).filter(Boolean)
    .forEach(function (stmt) { mem.public.none(stmt); });
  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();
  return {
    query: async function (text, params) { return (await pool.query(text, params)).rows; },
    tx: async function (fn) { return fn({ query: this.query }); },
  };
}

async function seedCatalog(db) {
  const shirt = await db.query("INSERT INTO products (sku,name,category,price,image,badge) VALUES ('p1','Men Shirt','men',97500,'images/p1.png','New') RETURNING id");
  const dress = await db.query("INSERT INTO products (sku,name,category,price,image,badge) VALUES ('p3','Women Dress','women',88500,'images/p3.png','') RETURNING id");
  await db.query("INSERT INTO product_colors (product_id,name,swatch) VALUES ($1,'Blue','#1e5aa8')", [shirt[0].id]);
  await db.query("INSERT INTO product_colors (product_id,name,swatch) VALUES ($1,'Navy','#002c3e')", [shirt[0].id]);
  await db.query("INSERT INTO product_colors (product_id,name,swatch) VALUES ($1,'Red','#c0392b')", [dress[0].id]);
  await db.query("INSERT INTO product_sizes (product_id,value) VALUES ($1,'M')", [shirt[0].id]);
  await db.query("INSERT INTO product_sizes (product_id,value) VALUES ($1,'L')", [shirt[0].id]);
  await db.query("INSERT INTO product_sizes (product_id,value) VALUES ($1,'S')", [dress[0].id]);
  return { shirt: shirt[0].id, dress: dress[0].id };
}

async function addUsers(db) {
  const mk = async function (email, name, role, pw) {
    const r = await db.query("INSERT INTO users (email,name,password_hash,role) VALUES ($1,$2,$3,$4) RETURNING id",
      [email, name, bcrypt.hashSync(pw, 10), role]);
    return r[0].id;
  };
  return { owner: await mk("owner@test.rw", "Owner", "owner", "ownerpass1"), staff: await mk("staff@test.rw", "Staff", "staff", "staffpass1") };
}

async function login(app, email, password) {
  const res = await request(app).post("/api/auth/login").send({ email: email, password: password });
  assert.equal(res.status, 200, email + " login: " + JSON.stringify(res.body));
  const cookie = res.headers["set-cookie"][0].split(";")[0];
  return cookie;
}

function orderBody(ids, extra) {
  return Object.assign({
    name: "Diane Uwase",
    phone: "0788123456",
    district: "Muhanga",
    zone: "Muhanga",
    momoRef: "20240611-112233",
    paid: true,
    items: [{ id: ids.shirt, size: "M", color: "Blue", qty: 2 }],
  }, extra || {});
}

test("public shop endpoint serves catalogue, reels and money rules", async function () {
  const db = makeDb();
  const ids = await seedCatalog(db);
  await S.upsertSettings({ query: db.query });
  await db.query("INSERT INTO reels (src,poster,title) VALUES ('reels/a.mp4','reels/a.jpg','Clip A')");
  const app = createApp({ db: db, cfg: { staticDir: null } });

  const res = await request(app).get("/api/shop");
  assert.equal(res.status, 200);
  assert.equal(res.body.products.length, 2);
  assert.deepEqual(res.body.products[0].sizes, ["M", "L"]);
  assert.equal(res.body.products[0].colors[0].name, "Blue");
  assert.equal(res.body.shop.whatsappNumber, "250783600961");
  assert.equal(res.body.momo.merchantNumber, "935237");
  assert.equal(res.body.delivery.zones.length, 3);
  assert.equal(res.body.reels[0].title, "Clip A");
  void ids;
});

test("order capture validates server side and prices from the database", async function () {
  const db = makeDb();
  const ids = await seedCatalog(db);
  await S.upsertSettings({ query: db.query });
  const app = createApp({ db: db, cfg: { staticDir: null } });

  const noRef = await request(app).post("/api/orders").send(orderBody(ids, { momoRef: "" }));
  assert.equal(noRef.status, 422);
  assert.match(JSON.stringify(noRef.body), /MoMo transaction reference/);

  const badPhone = await request(app).post("/api/orders").send(orderBody(ids, { phone: "12345" }));
  assert.equal(badPhone.status, 422);

  const fakeVariant = await request(app).post("/api/orders").send({
    name: "Diane", phone: "0788123456", district: "Muhanga", zone: "Muhanga",
    momoRef: "ABC123456", paid: true, items: [{ id: ids.shirt, size: "XXL", color: "Blue", qty: 1 }],
  });
  assert.equal(fakeVariant.status, 400);
  assert.match(fakeVariant.body.error, /real size/);

  const notForSale = await request(app).post("/api/orders").send({
    name: "Diane", phone: "0788123456", district: "Muhanga", zone: "Muhanga",
    momoRef: "ABC123456", paid: true, items: [{ id: 9999, size: "M", color: "Blue", qty: 1 }],
  });
  assert.equal(notForSale.status, 400);

  // the client cannot set the price
  const priced = await request(app).post("/api/orders").send({
    name: "Diane", phone: "0788123456", district: "Muhanga", zone: "Muhanga",
    momoRef: "ABC123456", paid: true, items: [{ id: ids.shirt, size: "M", color: "Blue", qty: 1, unit_price: 1 }],
  });
  assert.equal(priced.status, 201);
  assert.equal(priced.body.subtotal, 97500);
  assert.equal(priced.body.delivery_fee, 1500);
  assert.equal(priced.body.total, 99000);
  assert.match(priced.body.code, /^DEN-\d{8}-[A-Z0-9]{4}$/);

  const stored = await db.query("SELECT * FROM orders");
  assert.equal(stored.length, 1);
  assert.equal(stored[0].customer_phone, "250788123456");
});

test("referral codes attach to orders and commission is computed on goods only", async function () {
  const db = makeDb();
  const ids = await seedCatalog(db);
  await S.upsertSettings({ query: db.query });
  const users = await addUsers(db);
  const aff = await db.query("INSERT INTO affiliates (code,name,commission_pct) VALUES ('eric','Eric N',12) RETURNING id");
  await db.query("INSERT INTO users (email,name,password_hash,role,affiliate_id) VALUES ('eric@test.rw','Eric',$1,'advertiser',$2)",
    [bcrypt.hashSync("ericpass1", 10), aff[0].id]);
  const app = createApp({ db: db, cfg: { staticDir: null, siteUrl: "https://shop.test" } });

  const unknown = await request(app).post("/api/track").send({ code: "nobody", path: "/index.html" });
  assert.equal(unknown.body.ok, false);
  const known = await request(app).post("/api/track").send({ code: "ERIC", path: "/product.html" });
  assert.equal(known.body.ok, true);

  const res = await request(app).post("/api/orders").send(orderBody(ids, { affiliateCode: "eric" }));
  assert.equal(res.status, 201);
  assert.equal(res.body.affiliate_code, "eric");
  assert.equal(res.body.commission_pct, 12);

  const eric = await login(app, "eric@test.rw", "ericpass1");
  const me = await request(app).get("/api/affiliate/me").set("Cookie", eric);
  assert.equal(me.status, 200);
  assert.equal(me.body.code, "eric");
  assert.equal(me.body.link, "https://shop.test/r/eric");
  assert.equal(me.body.orders.length, 1);
  // a brand new order is not payable yet
  assert.equal(me.body.earned_goods_value, 0);
  assert.equal(me.body.earned_commission, 0);

  const owner = await login(app, "owner@test.rw", "ownerpass1");
  await request(app).patch("/api/admin/orders/" + res.body.id).set("Cookie", owner).send({ status: "confirmed" });

  const me2 = await request(app).get("/api/affiliate/me").set("Cookie", eric);
  // 2 x 97,500 = 195,000 goods, 12% = 23,400
  assert.equal(me2.body.earned_goods_value, 195000);
  assert.equal(me2.body.earned_commission, 23400);

  const affList = await request(app).get("/api/admin/affiliates").set("Cookie", owner);
  const ericRow = affList.body.affiliates.find(function (x) { return x.code === "eric"; });
  assert.equal(ericRow.order_count, 1);
  assert.equal(ericRow.earned, 23400);

  // an advertiser must not reach the admin order list
  const forbidden = await request(app).get("/api/admin/orders").set("Cookie", eric);
  assert.equal(forbidden.status, 403);
  void users;
});

test("roles gate the dashboard endpoints", async function () {
  const db = makeDb();
  await seedCatalog(db);
  await S.upsertSettings({ query: db.query });
  const users = await addUsers(db);
  const app = createApp({ db: db, cfg: { staticDir: null } });

  const anon = await request(app).get("/api/admin/orders");
  assert.equal(anon.status, 401);

  const staff = await login(app, "staff@test.rw", "staffpass1");
  const owner = await login(app, "owner@test.rw", "ownerpass1");

  const settingsByStaff = await request(app).put("/api/admin/settings").set("Cookie", staff).send({ "momo.number": "0780000000" });
  assert.equal(settingsByStaff.status, 403);
  const usersByStaff = await request(app).get("/api/admin/users").set("Cookie", staff);
  assert.equal(usersByStaff.status, 403);

  const okSettings = await request(app).put("/api/admin/settings").set("Cookie", owner).send({ "momo.number": "0780000000" });
  assert.equal(okSettings.status, 200);
  assert.equal(okSettings.body.settings["momo.number"], "0780000000");

  const badWhats = await request(app).put("/api/admin/settings").set("Cookie", owner).send({ "shop.whatsapp": "12345" });
  assert.equal(badWhats.status, 400);

  const badZones = await request(app).put("/api/admin/settings").set("Cookie", owner).send({ "delivery.zones": "{not json" });
  assert.equal(badZones.status, 400);

  const wrongPw = await request(app).post("/api/auth/login").send({ email: "owner@test.rw", password: "nope" });
  assert.equal(wrongPw.status, 401);
  void users;
});

test("admin can add a product, add missing colours, edit price and hide a sold product", async function () {
  const db = makeDb();
  const ids = await seedCatalog(db);
  await S.upsertSettings({ query: db.query });
  await addUsers(db);
  const app = createApp({ db: db, cfg: { staticDir: null } });
  const owner = await login(app, "owner@test.rw", "ownerpass1");

  const created = await request(app).post("/api/admin/products").set("Cookie", owner).send({
    name: "Kids Tee", category: "kids", price: 35000, image: "images/p9.png", badge: "New",
    colors: [{ name: "Yellow", swatch: "#e8c33a" }, { name: "Green" }], sizes: ["S", "M"],
  });
  assert.equal(created.status, 201);
  const kidId = created.body.id;

  const after = await request(app).get("/api/admin/products").set("Cookie", owner);
  const kid = after.body.products.find(function (p) { return p.id === kidId; });
  assert.deepEqual(kid.colors.map(function (c) { return c.name; }), ["Yellow", "Green"]);
  assert.equal(kid.colors[1].swatch, "#d9d9d9");

  const dup = await request(app).post("/api/admin/products/" + kidId + "/colors").set("Cookie", owner).send({ name: "Yellow", swatch: "#000000" });
  assert.equal(dup.body.added.length, 0);
  const added = await request(app).post("/api/admin/products/" + kidId + "/colors").set("Cookie", owner).send({ name: "Pink", swatch: "#e58fb1" });
  assert.equal(added.body.added.length, 1);

  const junk = await request(app).post("/api/admin/products/" + kidId + "/colors").set("Cookie", owner).send({ name: "Bad", swatch: "javascript:alert(1)" });
  assert.equal(junk.status, 400);
  const noName = await request(app).post("/api/admin/products/" + kidId + "/colors").set("Cookie", owner).send({ swatch: "#ffffff" });
  assert.equal(noName.status, 400);

  const shortName = await request(app).post("/api/admin/products").set("Cookie", owner).send({ name: "A", price: 100, image: "x.png" });
  assert.equal(shortName.status, 400);
  const negPrice = await request(app).post("/api/admin/products").set("Cookie", owner).send({ name: "Tee", price: -5, image: "x.png" });
  assert.equal(negPrice.status, 400);

  const patch = await request(app).patch("/api/admin/products/" + ids.dress).set("Cookie", owner).send({ price: 92000 });
  assert.equal(patch.status, 200);
  const shop = await request(app).get("/api/shop");
  assert.equal(shop.body.products.find(function (p) { return p.id === ids.dress; }).price, 92000);

  // order the shirt, then try to delete it
  await request(app).post("/api/orders").send(orderBody(ids));
  const del = await request(app).delete("/api/admin/products/" + ids.shirt).set("Cookie", owner);
  assert.equal(del.status, 200);
  assert.equal(del.body.hidden, true);
  const shop2 = await request(app).get("/api/shop");
  assert.equal(shop2.body.products.some(function (p) { return p.id === ids.shirt; }), false);

  const delClean = await request(app).delete("/api/admin/products/" + kidId).set("Cookie", owner);
  assert.equal(delClean.body.deleted, true);
});

test("order list filters, status changes and advertiser isolation", async function () {
  const db = makeDb();
  const ids = await seedCatalog(db);
  await S.upsertSettings({ query: db.query });
  await addUsers(db);
  const a1 = await db.query("INSERT INTO affiliates (code,name,commission_pct) VALUES ('ann','Ann',10) RETURNING id");
  const a2 = await db.query("INSERT INTO affiliates (code,name,commission_pct) VALUES ('bob','Bob',20) RETURNING id");
  await db.query("INSERT INTO users (email,name,password_hash,role,affiliate_id) VALUES ('ann@test.rw','Ann',$1,'advertiser',$2)", [bcrypt.hashSync("annpass1", 10), a1[0].id]);
  const app = createApp({ db: db, cfg: { staticDir: null } });
  const owner = await login(app, "owner@test.rw", "ownerpass1");

  const annOrder = await request(app).post("/api/orders").send(orderBody(ids, { affiliateCode: "ann" }));
  const bob = await request(app).post("/api/orders").send(orderBody(ids, { affiliateCode: "bob", zone: "Kigali City" }));

  const all = await request(app).get("/api/admin/orders").set("Cookie", owner);
  assert.equal(all.body.total, 2);
  assert.equal(all.body.orders[0].item_count, 1);

  const byAff = await request(app).get("/api/admin/orders?affiliate=ann").set("Cookie", owner);
  assert.equal(byAff.body.total, 1);

  const byStatus = await request(app).get("/api/admin/orders?status=confirmed").set("Cookie", owner);
  assert.equal(byStatus.body.total, 0);
  const patch = await request(app).patch("/api/admin/orders/" + bob.body.id).set("Cookie", owner).send({ status: "confirmed" });
  assert.equal(patch.status, 200);
  const confirmed = await request(app).get("/api/admin/orders?status=confirmed").set("Cookie", owner);
  assert.equal(confirmed.body.total, 1);
  const badStatus = await request(app).patch("/api/admin/orders/" + bob.body.id).set("Cookie", owner).send({ status: "nonsense" });
  assert.equal(badStatus.status, 400);

  const search = await request(app).get("/api/admin/orders?q=diane").set("Cookie", owner);
  assert.equal(search.body.total, 2);

  const ann = await login(app, "ann@test.rw", "annpass1");
  const annMe = await request(app).get("/api/affiliate/me").set("Cookie", ann);
  assert.equal(annMe.body.order_count, 1);
  assert.equal(annMe.body.earned_goods_value, 0);

  await request(app).patch("/api/admin/orders/" + annOrder.body.id).set("Cookie", owner).send({ status: "delivered" });
  const annMe2 = await request(app).get("/api/affiliate/me").set("Cookie", ann);
  assert.equal(annMe2.body.earned_goods_value, 195000);
  assert.equal(annMe2.body.earned_commission, 19500);

  const affList = await request(app).get("/api/admin/affiliates").set("Cookie", owner);
  const annRow = affList.body.affiliates.find(function (x) { return x.code === "ann"; });
  assert.equal(annRow.order_count, 1);
  const bobRow = affList.body.affiliates.find(function (x) { return x.code === "bob"; });
  assert.equal(bobRow.revenue, 195000 + 2000);
});

test("affiliate and staff accounts are created through the dashboard endpoints", async function () {
  const db = makeDb();
  await seedCatalog(db);
  await S.upsertSettings({ query: db.query });
  await addUsers(db);
  const app = createApp({ db: db, cfg: { staticDir: null } });
  const owner = await login(app, "owner@test.rw", "ownerpass1");

  const created = await request(app).post("/api/admin/affiliates").set("Cookie", owner).send({
    code: "Celine!", name: "Celine", phone: "0788777666", commission_pct: 15,
    email: "celine@test.rw", password: "celinepass1",
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.code, "celine");
  assert.ok(created.body.user_id);

  const dupe = await request(app).post("/api/admin/affiliates").set("Cookie", owner).send({ code: "celine", name: "Other", commission_pct: 5 });
  assert.equal(dupe.status, 400);

  const badRate = await request(app).post("/api/admin/affiliates").set("Cookie", owner).send({ code: "too", name: "Too", commission_pct: 90 });
  assert.equal(badRate.status, 400);

  const celine = await login(app, "celine@test.rw", "celinepass1");
  const me = await request(app).get("/api/affiliate/me").set("Cookie", celine);
  assert.equal(me.body.commission_pct, 15);

  const staff = await request(app).post("/api/admin/users").set("Cookie", owner).send({ email: "newstaff@test.rw", name: "New Staff", password: "staffpass2", role: "staff" });
  assert.equal(staff.status, 201);
  const shortPw = await request(app).post("/api/admin/users").set("Cookie", owner).send({ email: "x@test.rw", name: "X", password: "abc", role: "staff" });
  assert.equal(shortPw.status, 400);
  const badRole = await request(app).post("/api/admin/users").set("Cookie", owner).send({ email: "y@test.rw", name: "Y", password: "abcdefgh", role: "wizard" });
  assert.equal(badRole.status, 400);

  const staffCookie = await login(app, "newstaff@test.rw", "staffpass2");
  const denied = await request(app).post("/api/admin/users").set("Cookie", staffCookie).send({ email: "z@test.rw", name: "Z", password: "abcdefgh", role: "staff" });
  assert.equal(denied.status, 403);
});

test("routes: health, short links, clean pages, guarded paths and 404s", async function () {
  const db = makeDb();
  await seedCatalog(db);
  await S.upsertSettings({ query: db.query });
  await db.query("INSERT INTO affiliates (code,name,commission_pct) VALUES ('eric','Eric',12)");
  const app = createApp({
    db: db,
    cfg: { staticDir: path.join(__dirname, "..", ".."), secureCookies: false, siteUrl: "https://shop.test" },
  });

  const health = await request(app).get("/api/health");
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);

  const short = await request(app).get("/r/eric");
  assert.equal(short.status, 302);
  assert.equal(short.headers.location, "/?ref=eric");
  const clicks = await db.query("SELECT code FROM referral_clicks");
  assert.equal(clicks.length, 1);
  assert.equal(clicks[0].code, "eric");

  const ghost = await request(app).get("/r/ghost");
  assert.equal(ghost.status, 404);
  assert.match(ghost.text, /no longer active/);

  const page = await request(app).get("/products");
  assert.equal(page.status, 200);
  assert.match(page.headers["content-type"], /html/);
  assert.match(page.text, /product_grid/);

  const root = await request(app).get("/");
  assert.equal(root.status, 200);
  assert.match(root.text, /Denny Shop/);

  assert.equal((await request(app).get("/server/app.js")).status, 404);
  assert.equal((await request(app).get("/server/schema.sql")).status, 404);

  const apiMiss = await request(app).get("/api/does-not-exist");
  assert.equal(apiMiss.status, 404);
  assert.equal(apiMiss.body.error, "No such endpoint");

  const page404 = await request(app).get("/nothing-here");
  assert.equal(page404.status, 404);
  assert.match(page404.text, /Back to the shop/);

  const aff = await request(app).get("/api/admin/affiliates");
  assert.equal(aff.status, 401);
});

test("migrate imports the catalogue so the dashboard is never empty", async function () {
  const db = makeDb();
  const repoRoot = path.join(__dirname, "..", "..");
  const cfg = require("../import-config").readConfig(repoRoot);
  assert.ok(cfg.PRODUCTS.length > 0, "js/config.js must carry the catalogue");

  const report = await require("../import-config").importAll(db, repoRoot);
  assert.equal(report.products, cfg.PRODUCTS.length);
  assert.equal(report.skippedProducts, false);

  const catalog = await S.loadCatalog(db, { includeHidden: true });
  assert.equal(catalog.length, cfg.PRODUCTS.length);
  const first = catalog.filter(function (p) { return p.sku === cfg.PRODUCTS[0].id; })[0];
  assert.ok(first.colors.length > 0 && first.sizes.length > 0);
  assert.equal(first.price, Math.round(cfg.PRODUCTS[0].price));

  const settings = await S.getSettings(db);
  assert.equal(settings["shop.whatsapp"], cfg.SHOP.whatsappNumber);
  assert.equal(settings["momo.number"], cfg.MOMO.merchantNumber);
  assert.ok(JSON.parse(settings["delivery.zones"]).length > 0);

  // running it again must not duplicate anything
  const again = await require("../import-config").importAll(db, repoRoot);
  assert.equal(again.skippedProducts, true);
  assert.equal(again.products, 0);
  const after = await S.loadCatalog(db, { includeHidden: true });
  assert.equal(after.length, cfg.PRODUCTS.length);

  // the dashboard reads exactly what was imported
  await db.query("INSERT INTO users (email,name,password_hash,role) VALUES ('real.owner@example.rw','Owner',$1,'owner')",
    [bcrypt.hashSync("a-real-secret-10", 10)]);
  const app = createApp({ db: db, cfg: { staticDir: null } });
  const cookie = await login(app, "real.owner@example.rw", "a-real-secret-10");
  const list = await request(app).get("/api/admin/products").set("Cookie", cookie);
  assert.equal(list.body.products.length, cfg.PRODUCTS.length);
});

test("reels are editable through the dashboard", async function () {
  const db = makeDb();
  await seedCatalog(db);
  await S.upsertSettings({ query: db.query });
  await addUsers(db);
  const app = createApp({ db: db, cfg: { staticDir: null } });
  const owner = await login(app, "owner@test.rw", "ownerpass1");

  const added = await request(app).post("/api/admin/reels").set("Cookie", owner).send({
    src: "reels/eric.mp4", poster: "reels/eric.jpg", title: "Eric tries the shirt",
    meta: "From 84,500 RWF", consent: "Shown with Eric's OK, 10/11/2026.", link: "product.html?cat=men",
  });
  assert.equal(added.status, 201);
  const noSrc = await request(app).post("/api/admin/reels").set("Cookie", owner).send({ title: "No clip" });
  assert.equal(noSrc.status, 400);

  const list = await request(app).get("/api/admin/reels").set("Cookie", owner);
  assert.equal(list.body.reels.length, 1);
  assert.equal(list.body.reels[0].consent, "Shown with Eric's OK, 10/11/2026.");

  await request(app).patch("/api/admin/reels/" + added.body.id).set("Cookie", owner).send({ active: false });
  const shop = await request(app).get("/api/shop");
  assert.equal(shop.body.reels.length, 0);

  const del = await request(app).delete("/api/admin/reels/" + added.body.id).set("Cookie", owner);
  assert.equal(del.status, 200);
  const after = await request(app).get("/api/admin/reels").set("Cookie", owner);
  assert.equal(after.body.reels.length, 0);
});
