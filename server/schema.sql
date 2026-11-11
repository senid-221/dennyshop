-- Denny Shop schema (Postgres / Neon)
-- Money is stored in whole RWF.

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS affiliates (
  id             SERIAL PRIMARY KEY,
  code           TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  phone          TEXT,
  commission_pct NUMERIC(5,2) NOT NULL DEFAULT 10,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'staff',   -- owner | staff | advertiser
  affiliate_id  INTEGER REFERENCES affiliates(id),
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id         SERIAL PRIMARY KEY,
  token      TEXT NOT NULL UNIQUE,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id        SERIAL PRIMARY KEY,
  sku       TEXT UNIQUE,
  name      TEXT NOT NULL,
  category  TEXT NOT NULL DEFAULT 'men',
  price     INTEGER NOT NULL,
  image     TEXT NOT NULL,
  badge     TEXT NOT NULL DEFAULT '',
  active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_colors (
  id         SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  swatch     TEXT NOT NULL DEFAULT '#d9d9d9'
);

CREATE TABLE IF NOT EXISTS product_sizes (
  id         SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  value      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reels (
  id          SERIAL PRIMARY KEY,
  src         TEXT NOT NULL,
  poster      TEXT NOT NULL DEFAULT '',
  title       TEXT NOT NULL,
  meta        TEXT NOT NULL DEFAULT '',
  text        TEXT NOT NULL DEFAULT '',
  link        TEXT NOT NULL DEFAULT 'product.html',
  link_label  TEXT NOT NULL DEFAULT 'Shop now',
  consent     TEXT NOT NULL DEFAULT 'Product photos only - no people.',
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id             SERIAL PRIMARY KEY,
  code           TEXT NOT NULL UNIQUE,
  status         TEXT NOT NULL DEFAULT 'new',   -- new | paid | confirmed | delivered | cancelled
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  customer_name  TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT NOT NULL DEFAULT '',
  district       TEXT NOT NULL DEFAULT '',
  sector         TEXT NOT NULL DEFAULT '',
  landmark       TEXT NOT NULL DEFAULT '',
  map_url        TEXT NOT NULL DEFAULT '',
  zone           TEXT NOT NULL DEFAULT '',
  subtotal       INTEGER NOT NULL,
  delivery_fee   INTEGER NOT NULL,
  total          INTEGER NOT NULL,
  momo_number    TEXT NOT NULL DEFAULT '',
  momo_ref       TEXT NOT NULL DEFAULT '',
  paid_claimed   BOOLEAN NOT NULL DEFAULT FALSE,
  notes          TEXT NOT NULL DEFAULT '',
  affiliate_code TEXT NOT NULL DEFAULT '',
  source         TEXT NOT NULL DEFAULT 'web'
);

CREATE TABLE IF NOT EXISTS order_items (
  id           SERIAL PRIMARY KEY,
  order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id   INTEGER NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  size         TEXT NOT NULL DEFAULT '',
  color        TEXT NOT NULL DEFAULT '',
  qty          INTEGER NOT NULL,
  unit_price   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS referral_clicks (
  id         SERIAL PRIMARY KEY,
  code       TEXT NOT NULL,
  path       TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_created   ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_affiliate ON orders (affiliate_code);
CREATE INDEX IF NOT EXISTS idx_orders_status    ON orders (status);
CREATE INDEX IF NOT EXISTS idx_colors_product   ON product_colors (product_id);
CREATE INDEX IF NOT EXISTS idx_sizes_product    ON product_sizes (product_id);
CREATE INDEX IF NOT EXISTS idx_items_order      ON order_items (order_id);
