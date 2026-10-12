import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const root = resolve(".");
const directory = await mkdtemp(join(tmpdir(), "affix-package-"));
const npm = process.env.npm_execpath || new URL("../lib/node_modules/npm/bin/npm-cli.js", `file://${process.execPath}`).pathname;
function run(command, args, cwd = root) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", env: { ...process.env, npm_config_cache: join(directory, "cache") } });
    child.on("error", reject);
    child.on("close", status => status === 0 ? resolve() : reject(new Error(`Command failed: ${command}`)));
  });
}
try {
  await run(process.execPath, [npm, "pack", "--ignore-scripts", "--silent", "--pack-destination", directory]);
  const archive = join(directory, "affixio-2.0.3.tgz");
  const bytes = await readFile(archive);
  await run("tar", ["-xzf", archive, "-C", directory]);
  const names = await readdir(join(directory, "package"), { recursive: true });
  for (const name of ["dist/runtime/index.js", "dist/runtime/index.d.ts", "dist/runtime/browser.js", "dist/mcp-connect.js", "python/affixio_client.py", "docs/2.0.0.md"]) assert.ok(names.includes(name), `Missing ${name}`);
  assert.ok(!names.some(name => /(^|\/)(node_modules|\.affix|__pycache__|runtime-data)(\/|$)|\.pyc$/.test(name)));
  const pkg = JSON.parse(await readFile(join(directory, "package/package.json"), "utf8"));
  assert.equal(pkg.version, "2.0.3");
  for (const entry of Object.values(pkg.exports)) for (const path of Object.values(entry)) await readFile(join(directory, "package", path));
  console.log(JSON.stringify({ version: pkg.version, entries: names.length, compressedBytes: bytes.length,
    integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`, exportPathsChecked: true }, null, 2));
} finally { await rm(directory, { recursive: true, force: true }); }
