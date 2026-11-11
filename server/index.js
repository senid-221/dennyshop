/* Entry point: node index.js  (needs DATABASE_URL) */
require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const db = require("./db");
const { createApp } = require("./app");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required. Copy .env.example to .env and paste your Neon connection string.");
  process.exit(1);
}

db.configure(DATABASE_URL);

const app = createApp({
  db: { query: db.query, tx: db.tx },
  cfg: {
    staticDir: require("path").join(__dirname, ".."),
    secureCookies: process.env.INSECURE_COOKIES !== "1",
    siteUrl: process.env.PUBLIC_URL || "",
  },
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, function () {
  console.log("Denny Shop API + site on http://127.0.0.1:" + port);
});
