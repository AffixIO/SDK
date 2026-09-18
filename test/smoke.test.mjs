/* Credit: @paparichens */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const requireJson = createRequire(import.meta.url);

test("TypeScript source tree is present", () => {
  assert.equal(existsSync(join(root, "src/index.ts")), true);
  assert.equal(existsSync(join(root, "src/agentic-pay-kit.ts")), true);
  assert.equal(existsSync(join(root, "src/agent-trust/session.ts")), true);
  assert.equal(existsSync(join(root, "tsconfig.json")), true);
});

test("compiled package entry exists", () => {
  assert.equal(existsSync(join(root, "dist/index.js")), true);
  assert.equal(existsSync(join(root, "dist/index.d.ts")), true);
  assert.equal(existsSync(join(root, "dist/cli.js")), true);
});

test("package identity", () => {
  const pkg = requireJson("../package.json");
  assert.equal(pkg.name, "affixio");
  assert.equal(pkg.license, "Apache-2.0");
  assert.equal(pkg.type, "module");
  assert.equal(pkg.scripts.build.includes("tsc"), true);
});

test("public exports and host-side helpers", async () => {
  const sdk = await import("../dist/index.js");
  assert.equal(typeof sdk.AffixSDK, "function");
  assert.equal(typeof sdk.createAgentTrust, "function");
  assert.equal(typeof sdk.agenticPay, "function");
  assert.equal(typeof sdk.x402BeforePay, "function");
  assert.equal(typeof sdk.mcpToolGate, "function");
  assert.equal(typeof sdk.createPaymentMandate, "function");
  assert.equal(typeof sdk.defaultContext, "function");
  assert.equal(typeof sdk.normaliseApiBase, "function");
  assert.equal(typeof sdk.proofDigest, "function");
  assert.equal(typeof sdk.packCarrier, "function");
  assert.equal(sdk.DEFAULT_AFFIX_API_BASE, "https://api.affix-io.com");
  assert.equal(sdk.normaliseApiBase("https://api.affix-io.com/"), "https://api.affix-io.com");
  const ctx = sdk.defaultContext({ required_claim_hash: "approved" });
  assert.equal(ctx.required_claim_hash, "approved");
  assert.equal(typeof ctx.secret, "string");
  const digest = sdk.proofDigest("00", "simple_yesno", true);
  assert.equal(digest.length, 64);
});

test("local ML-DSA-65 keypair can be created without network", async () => {
  const { createLocalSigningKeyPair, canonicalLocalPayload, signLocalPayload, verifyLocalPayload } = await import("../dist/index.js");
  const keys = createLocalSigningKeyPair();
  assert.equal(keys.algorithm, "ML-DSA-65");
  assert.equal(typeof keys.public_key_b64, "string");
  const payload = { action: "checkout.pay", allowed: true };
  const att = signLocalPayload(payload, {
    hmacSecret: "smoke-test-hmac-secret-key",
    secretKeyB64: keys.secret_key_b64,
    publicKeyB64: keys.public_key_b64,
  });
  assert.equal(att.algorithm, "HMAC-SHA256+ML-DSA-65");
  assert.equal(verifyLocalPayload(payload, att, "smoke-test-hmac-secret-key"), true);
  assert.equal(typeof canonicalLocalPayload(payload), "string");
});
