/* Root entrypoint for Vercel projects whose Framework Preset is Node.js.
   Those builders refuse to build without app.js / index.js / server.js at the
   project root, which is why this repo failed there while the same code built
   fine under the Other preset. It exports the very same request handler the
   api/ function uses, so there is only one app in the repository.
   Projects on the Other preset ignore this file (only api/ becomes functions). */
module.exports = require("./api/index.js");
