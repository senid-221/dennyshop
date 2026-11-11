/* Sessions, passwords and role gates. No framework, no external auth service. */
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const COOKIE = "dsess";
const SESSION_HOURS = 12;

function hashPassword(plain) {
  return bcrypt.hashSync(String(plain), 10);
}

function checkPassword(plain, hash) {
  return bcrypt.compareSync(String(plain), String(hash));
}

function newToken() {
  return crypto.randomBytes(24).toString("hex");
}

function parseCookies(header) {
  const out = {};
  String(header || "").split(";").forEach(function (part) {
    const i = part.indexOf("=");
    if (i === -1) return;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function setSessionCookie(res, token, cfg) {
  const parts = [
    COOKIE + "=" + token,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=" + SESSION_HOURS * 3600,
  ];
  if (cfg.secureCookies) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(res, cfg) {
  const parts = [COOKIE + "=", "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (cfg.secureCookies) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

async function createSession(db, userId) {
  const token = newToken();
  const expires = new Date(Date.now() + SESSION_HOURS * 3600 * 1000);
  await db.query("INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)", [token, userId, expires]);
  return token;
}

function attachUser(db) {
  return async function (req, res, next) {
    req.user = null;
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token) return next();
    /* a database outage must sign people out, not crash the process */
    try {
      const rows = await db.query(
        "SELECT u.id, u.email, u.name, u.role, u.active, u.affiliate_id, a.code AS affiliate_code, a.commission_pct, a.name AS affiliate_name " +
        "FROM sessions s JOIN users u ON u.id = s.user_id " +
        "LEFT JOIN affiliates a ON a.id = u.affiliate_id " +
        "WHERE s.token = $1 AND s.expires_at > now()",
        [token]
      );
      if (rows.length) req.user = rows[0];
    } catch (e) {
      console.error("session lookup failed:", e.message);
    }
    next();
  };
}

function requireAuth(req, res, next) {
  if (!req.user || !req.user.active) return res.status(401).json({ error: "Sign in first" });
  next();
}

function requireRole() {
  const roles = Array.prototype.slice.call(arguments);
  return function (req, res, next) {
    if (!req.user || !req.user.active) return res.status(401).json({ error: "Sign in first" });
    if (roles.indexOf(req.user.role) === -1) return res.status(403).json({ error: "Not allowed for your role" });
    next();
  };
}

module.exports = {
  COOKIE, hashPassword, checkPassword, newToken, parseCookies,
  setSessionCookie, clearSessionCookie, createSession, attachUser,
  requireAuth, requireRole,
};
