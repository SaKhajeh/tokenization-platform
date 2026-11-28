#!/bin/sh
# Builds docs/simulation/simulation.html: the real credit-limit engine (packages/domain) bundled for the browser,
# plus the simulator (app.js) in the page shell. Run from the repository root after changing the rules.
set -e
cd "$(dirname "$0")"
../../node_modules/.bin/esbuild entry.ts --bundle --format=iife --global-name=TP --minify --platform=browser --target=es2020 --outfile=engine.js --log-level=warning
node -e '
const fs = require("fs");
const page = fs.readFileSync("shell.html", "utf8")
  .replace("/*ENGINE*/", () => fs.readFileSync("engine.js", "utf8") + ";window.TP=TP;")
  .replace("/*APP*/", () => fs.readFileSync("app.js", "utf8"));
fs.writeFileSync("simulation.html", page);
fs.unlinkSync("engine.js");
console.log("docs/simulation/simulation.html", page.length, "bytes");'
