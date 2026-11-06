import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const starters = [
  "templates/express/server.mjs",
  "templates/fastify/server.mjs",
  "templates/nextjs/app/api/tools/search/route.ts",
];

test("npm pack ships starter templates and no template secrets", () => {
  const result = spawnSync("npm", ["pack", "--dry-run", "--ignore-scripts", "--silent", "--json"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const packed = JSON.parse(result.stdout.slice(result.stdout.indexOf("[")));
  const files = packed[0].files.map(file => file.path);
  for (const name of starters) assert.ok(files.includes(name), `Missing ${name}`);
  const secrets = files.filter(name => name.startsWith("templates/") && /(^|\/)node_modules(\/|$)|(^\.env$|\/\.env$|\/\.env\.)|(^|\/)secrets(\/|$)|(^|\/)[^/]+\.key$/.test(name));
  assert.deepEqual(secrets, []);
});
