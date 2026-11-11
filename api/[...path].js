/* Wildcard API entry for Vercel: every /api/... path lands on the Express app.
   Named this way so it does not depend on rewrites or cleanUrls. */
module.exports = require("./index.js");
