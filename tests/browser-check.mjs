import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
import { createEvidenceBundle } from "../dist/runtime/evidence.js";
import { createLocalSigningKeyPair } from "../dist/local-signing.js";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = resolve(".");
const imports = { "@noble/post-quantum/ml-dsa": "/node_modules/@noble/post-quantum/esm/ml-dsa.js" };
const hashes = JSON.parse(await readFile("node_modules/@noble/hashes/package.json", "utf8"));
for (const [name, value] of Object.entries(hashes.exports)) {
  if (name.startsWith("./") && typeof value.import === "string") imports[`@noble/hashes/${name.slice(2)}`] = `/node_modules/@noble/hashes/${value.import.slice(2)}`;
}
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== "https://sdk.test") return route.abort();
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><script type="importmap">${JSON.stringify({ imports })}</script></head><body><main id="report"></main></body></html>` });
    const relative = decodeURIComponent(url.pathname).slice(1);
    const path = resolve(root, relative);
    if (!path.startsWith(root + "/") || (!relative.startsWith("dist/runtime/") && !relative.startsWith("node_modules/@noble/"))) return route.abort();
    try { return route.fulfill({ contentType: "text/javascript", body: await readFile(path) }); }
    catch { return route.fulfill({ status: 404, body: "Not found" }); }
  });
  await page.goto("https://sdk.test/");
  const keys = createLocalSigningKeyPair();
  const bundle = createEvidenceBundle([{ name: "decision", data: { decision: "allow" } }], { signing: {
    hmacSecret: "browser-test-server-secret", secretKeyB64: keys.secret_key_b64, publicKeyB64: keys.public_key_b64,
  } });
  const result = await page.evaluate(async ({ bundle, publicKey }) => {
    const module = await import("/dist/runtime/browser.js");
    const untrusted = await module.verifyEvidenceBundle(bundle);
    const valid = await module.verifyEvidenceBundle(bundle, { trustedPublicKeys: [publicKey] });
    module.renderEvidenceSummary(document.querySelector("#report"), valid);
    bundle.artifacts[0].data.decision = "deny";
    const tampered = await module.verifyEvidenceBundle(bundle, { trustedPublicKeys: [publicKey] });
    return { valid, untrusted, tampered, hasNode: typeof process !== "undefined" || typeof Buffer !== "undefined" };
  }, { bundle, publicKey: keys.public_key_b64 });
  assert.equal(result.valid.signatureValid, true);
  assert.equal(result.untrusted.signatureValid, false);
  assert.equal(result.tampered.integrityValid, false);
  assert.equal(result.hasNode, false);
  assert.deepEqual(errors, []);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }
  if (process.env.BROWSER_SCREENSHOT) await page.screenshot({ path: resolve(process.env.BROWSER_SCREENSHOT) });
  console.log("Chromium: trusted signature, tamper rejection, browser-only imports and summary rendering passed");
} finally { await browser.close(); }
