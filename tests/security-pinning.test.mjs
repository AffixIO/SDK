// 2.0.0-beta.2 regression tests: ML-DSA signer pinning and HMAC device refusal.
// Fixtures reuse Articus's Zenoh run (public key + signed commands only, no secrets).
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import {
  AffixSDK, AffixTrustError, AffixHmacRoleError, createLocalSigningKeyPair, signLocalPayload, verifyLocalPayload,
  verifyLocalAttestation, verifyProofEnvelope, wrapProofEnvelope, lightProve, fetchAffixioKeys, clearAffixioKeyCache,
  verifyAffixioAttestation, createReplayGuard, MemoryReplayStore,
} from "../dist/index.js";
import { verifyArtifactOffline, verifySignedRoot, createMockSthSigner } from "../dist/extensions/index.js";
import { createEvidenceBundle, verifyEvidenceBundle, verifyPublicEnvelope, createReplayGuard as wfReplay } from "../dist/runtime/index.js";
import { normaliseWitnessInputs } from "../dist/witness.js";

const fixture = JSON.parse(await readFile(new URL("./fixtures/zenoh-local.json", import.meta.url), "utf8"));
const signer = fixture.signer;
const zenohAttestation = (cmd) => {
  const payload = JSON.parse(cmd.envelope_canonical);
  return { payload, attestation: {
    schema: "affix.local-signature.v1", algorithm: "HMAC-SHA256+ML-DSA-65", signed_at: new Date().toISOString(),
    payload_digest: createHash("sha256").update(cmd.envelope_canonical).digest("hex"), key_id: cmd.key_id,
    hmac_b64: "", mldsa_signature_b64: cmd.mldsa_sig_b64, mldsa_public_key_b64: signer.public_key_b64 } };
};
const SECRET = "regression-test-shared-secret-0123";
const genuine = createLocalSigningKeyPair();
const attacker = createLocalSigningKeyPair();
const sign = (payload, keys) => signLocalPayload(payload, { hmacSecret: SECRET, secretKeyB64: keys.secret_key_b64, publicKeyB64: keys.public_key_b64 });
const pin = [{ key_id: genuine.key_id, public_key_b64: genuine.public_key_b64 }];

test("Zenoh fixture: correct pinned key passes (ML-DSA only, no HMAC secret)", () => {
  for (const cmd of fixture.commands) {
    const { payload, attestation } = zenohAttestation(cmd);
    const r = verifyLocalAttestation(payload, attestation, { trustedKeys: signer, rejectLegacyV1: false });
    assert.equal(r.valid, true, r.reason);
    assert.equal(r.key_id, signer.key_id);
  }
});

test("forged signer: self-generated key pair is rejected even with consistent key_id", () => {
  const { payload } = zenohAttestation(fixture.commands[0]);
  const forged = sign(payload, attacker); // key_id + embedded key match the attacker's own key
  assert.equal(verifyLocalAttestation(payload, forged, { trustedKeys: signer, rejectLegacyV1: false }).reason, "untrusted_signer");
  // claims the genuine key_id but embeds attacker key
  assert.equal(verifyLocalAttestation(payload, { ...forged, key_id: signer.key_id }, { trustedKeys: signer, rejectLegacyV1: false }).reason, "untrusted_signer");
  // claims genuine key_id + genuine embedded key, attacker signature
  assert.equal(verifyLocalAttestation(payload, { ...forged, key_id: signer.key_id, mldsa_public_key_b64: signer.public_key_b64 }, { trustedKeys: signer, rejectLegacyV1: false }).reason, "invalid_signature");
  // 1.x/beta.1 behaviour reproduced only with the explicit insecure opt-out
  assert.equal(verifyLocalAttestation(payload, forged, { insecureTrustEmbeddedKey: true }).valid, true);
  // full HMAC path too: attacker who also knows the secret still fails against the pin
  assert.equal(verifyLocalPayload(payload, forged, SECRET, { trustedKeys: pin }), false);
  assert.equal(verifyProofEnvelope({ payload, attestation: forged }, SECRET, { trustedKeys: pin }), false);
});

test("tampered payload / signature / key_id is rejected (Zenoh tamper cases)", () => {
  const { payload, attestation } = zenohAttestation(fixture.commands[1]);
  const opts = { trustedKeys: signer, rejectLegacyV1: false };
  assert.equal(verifyLocalAttestation({ ...payload, decision: "no" }, attestation, opts).valid, false);
  assert.equal(verifyLocalAttestation({ ...payload, proof: payload.proof + "00" }, attestation, opts).valid, false);
  const sig = attestation.mldsa_signature_b64; const l = sig.length;
  assert.equal(verifyLocalAttestation(payload, { ...attestation, mldsa_signature_b64: sig.slice(0, l - 8) + "AAAA" + sig.slice(l - 4) }, opts).valid, false);
  assert.equal(verifyLocalAttestation(payload, { ...attestation, key_id: "0000000000000000" }, opts).reason, "untrusted_signer");
  // digest recomputed by attacker, signature unchanged
  const edited = { ...payload, decision: "no" };
  const forgedDigest = createHash("sha256").update(JSON.stringify(Object.fromEntries(Object.keys(edited).sort().map(k => [k, edited[k]])))).digest("hex");
  assert.equal(verifyLocalAttestation(edited, { ...attestation, payload_digest: forgedDigest }, opts).reason, "invalid_signature");
});

test("missing trust config fails closed with a clear error on every path", async () => {
  const payload = { a: 1 };
  const att = sign(payload, genuine);
  assert.throws(() => verifyLocalAttestation(payload, att, {}), (e) => e instanceof AffixTrustError && e.code === "no_trusted_keys");
  assert.throws(() => verifyLocalPayload(payload, att, SECRET), AffixTrustError);
  assert.throws(() => verifyProofEnvelope({ payload, attestation: att }, SECRET), AffixTrustError);
  const off = verifyArtifactOffline({ proof: payload, attestation: att, hmacSecret: SECRET });
  assert.equal(off.ok, false);
  assert.match(off.errors.join(" "), /no_trusted_keys/);
  assert.equal((await verifyPublicEnvelope({ payload, attestation: att })).reason, "no_trusted_keys");
  assert.throws(() => verifySignedRoot({ root: "aa", signature_b64: "AA==" }, undefined), AffixTrustError);
  assert.throws(() => verifyLocalAttestation(payload, att, { trustedKeys: "not-a-key" }), AffixTrustError);
});

test("offline verify (affixio/offline): pinned passes, forged fails", () => {
  const payload = { proof_id: "p1", decision: "yes" };
  const ok = verifyArtifactOffline({ proof: payload, attestation: sign(payload, genuine), trustedKeys: pin, allowUnbound: true });
  assert.equal(ok.checks[0].ok, true, JSON.stringify(ok));
  const bad = verifyArtifactOffline({ proof: payload, attestation: sign(payload, attacker), trustedKeys: pin, allowUnbound: true });
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0], /untrusted_signer/);
  const withHmac = verifyArtifactOffline({ proof: payload, attestation: sign(payload, genuine), trustedKeys: pin, hmacSecret: SECRET, allowUnbound: true });
  assert.match(withHmac.checks[0].detail, /HMAC/);
});

test("STH verify (affixio/sth): accepts a pinned key set, rejects other keys", () => {
  const sthSigner = createMockSthSigner();
  const other = createMockSthSigner();
  const sth = sthSigner.signSth({ tree_size: 1, root: "ab".repeat(32) });
  assert.equal(verifySignedRoot(sth, sthSigner.public_key_b64), true);
  assert.equal(verifySignedRoot(sth, { keys: [{ key_id: "k1", algorithm: "ML-DSA-65", public_key_b64: sthSigner.public_key_b64, status: "active" }] }), true);
  assert.equal(verifySignedRoot(sth, [{ public_key_b64: other.public_key_b64 }]), false);
});

test("evidence bundles (affixio/workflows + browser): pinned key set passes, other signer fails", async () => {
  const bundle = createEvidenceBundle([{ name: "a", data: { x: 1 } }], { signing: { hmacSecret: SECRET, secretKeyB64: genuine.secret_key_b64, publicKeyB64: genuine.public_key_b64 } });
  assert.equal((await verifyEvidenceBundle(bundle, { trustedKeys: { keys: pin } })).signatureValid, true);
  assert.equal((await verifyEvidenceBundle(bundle, { trustedPublicKeys: [genuine.public_key_b64] })).signatureValid, true);
  const r = await verifyEvidenceBundle(bundle, { trustedPublicKeys: [attacker.public_key_b64] });
  assert.equal(r.signatureValid, false); assert.equal(r.reason, "untrusted_signer");
  assert.equal((await verifyEvidenceBundle(bundle)).reason, "no_trusted_keys");
});

test("evidence CLI refuses to verify a signed bundle without a pinned key", async () => {
  const dir = await mkdtemp(join(tmpdir(), "affix-pin-"));
  const bundle = createEvidenceBundle([{ name: "a", data: 1 }], { signing: { hmacSecret: SECRET, secretKeyB64: genuine.secret_key_b64, publicKeyB64: genuine.public_key_b64 } });
  await writeFile(join(dir, "b.json"), JSON.stringify(bundle));
  await writeFile(join(dir, "k.json"), JSON.stringify({ keys: pin }));
  await writeFile(join(dir, "evil.txt"), attacker.public_key_b64);
  const cli = new URL("../dist/runtime/cli.js", import.meta.url).pathname;
  const none = spawnSync(process.execPath, [cli, "verify", join(dir, "b.json")], { encoding: "utf8" });
  assert.equal(none.status, 1); assert.match(none.stderr, /No trusted key/);
  assert.equal(spawnSync(process.execPath, [cli, "verify", join(dir, "b.json"), "--trusted-keyset", join(dir, "k.json")]).status, 0);
  assert.equal(spawnSync(process.execPath, [cli, "verify", join(dir, "b.json"), "--trusted-key", join(dir, "evil.txt")]).status, 1);
  const ext = new URL("../dist/cli-ext.js", import.meta.url).pathname;
  const payload = { p: 1 };
  await writeFile(join(dir, "env.json"), JSON.stringify({ payload, attestation: sign(payload, attacker) }));
  assert.equal(spawnSync(process.execPath, [ext, "verify-offline", "--attestation", join(dir, "env.json")]).status, 2);
  assert.equal(spawnSync(process.execPath, [ext, "verify-offline", "--attestation", join(dir, "env.json"), "--trusted-keyset", join(dir, "k.json")]).status, 2);
  await writeFile(join(dir, "env2.json"), JSON.stringify({ payload, attestation: sign(payload, genuine) }));
  assert.equal(spawnSync(process.execPath, [ext, "verify-offline", "--attestation", join(dir, "env2.json"), "--trusted-keyset", join(dir, "k.json")]).status, 2, "binding required");
  assert.equal(spawnSync(process.execPath, [ext, "verify-offline", "--attestation", join(dir, "env2.json"), "--trusted-keyset", join(dir, "k.json"), "--allow-unbound"]).status, 0);
});

async function makeSdk(extra = {}) {
  const dir = await mkdtemp(join(tmpdir(), "affix-sdk-"));
  return new AffixSDK({ apiKey: "local_operator", apiBase: "http://127.0.0.1:9", hmacSecret: SECRET, signingKeys: genuine,
    operatorBaseDir: join(dir, ".affix"), licenceStatePath: join(dir, "l.json"), proofStorePath: join(dir, "p.json"),
    statsPath: join(dir, "s.json"), offlineQueuePath: join(dir, "q.json"), spendDir: join(dir, "spend"), silenceHmacWarning: true, ...extra });
}
const lightProof = () => lightProve({ circuit_id: "simple_yesno", inputs: normaliseWitnessInputs({ a: "0x1" }) }, SECRET, { decision: "yes" }).proof;

test("verifyLocal: own key pinned by default; forged envelope rejected; peers via trustedSigningKeys", async () => {
  const sdk = await makeSdk();
  const proof = lightProof();
  const payload = { proof_id: "x", circuit_id: "simple_yesno", proof, decision: "yes" };
  const good = wrapProofEnvelope(payload, { hmacSecret: SECRET, signingKeys: genuine });
  const r1 = await sdk.verifyLocal("simple_yesno", proof, { envelope: good });
  assert.equal(r1.valid, true); assert.equal(r1.envelope_ok, true);
  const forged = wrapProofEnvelope(payload, { hmacSecret: SECRET, signingKeys: attacker });
  const r2 = await sdk.verifyLocal("simple_yesno", proof, { envelope: forged });
  assert.equal(r2.envelope_ok, false); assert.equal(r2.envelope_reason, "untrusted_signer");
  const sdk2 = await makeSdk({ trustedSigningKeys: [attacker.public_key_b64] });
  assert.equal((await sdk2.verifyLocal("simple_yesno", proof, { envelope: forged })).envelope_ok, true);
  assert.equal(sdk.trustedKeys()[0].key_id, genuine.key_id);
});

test("HMAC on a device is refused; server role still verifies HMAC", async () => {
  const proof = lightProof();
  const server = await makeSdk();
  assert.equal((await server.verifyLocal("simple_yesno", proof)).valid, true);
  for (const role of ["device", "edge", "offline-verifier"]) {
    const dev = await makeSdk({ role });
    await assert.rejects(dev.verifyLocal("simple_yesno", proof), (e) => e instanceof AffixHmacRoleError && e.code === "hmac_verify_refused_for_role");
  }
  // Zenoh fixture HMAC proof refused on device too
  const dev = await makeSdk({ role: "device" });
  await assert.rejects(dev.verifyLocal("simple_yesno", fixture.commands[0].proof_hex), AffixHmacRoleError);
  await assert.rejects(makeSdk({ role: "toaster" }), /invalid_role/);
});

test("AffixIO key set: fetched once, cached, used to verify server attestations; unavailable fails closed", async () => {
  clearAffixioKeyCache();
  const server = ml_dsa65.keygen(new Uint8Array(32).fill(7));
  const keySet = { schema: "affix.keys.v1", keys: [{ key_id: "mldsa65-test", algorithm: "ML-DSA-65", public_key_b64: Buffer.from(server.publicKey).toString("base64"), status: "active", not_before: "2026-01-01T00:00:00Z", not_after: null }] };
  let calls = 0;
  const fetch = async () => { calls++; return { ok: true, json: async () => keySet }; };
  const payload = { proof_id: "pf_1", valid: true };
  const digest = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const att = { signed_at: "2026-10-10T12:00:00Z", payload_digest: digest, algorithm: "ML-DSA-65",
    mldsa_signature_b64: Buffer.from(ml_dsa65.sign(server.secretKey, Buffer.from(digest, "hex"))).toString("base64") };
  assert.equal((await verifyAffixioAttestation(payload, att, { kind: "verify", allowVkOnly: true, fetch })).valid, true);
  assert.equal((await verifyAffixioAttestation({ ...payload, valid: false }, att, { kind: "verify", allowVkOnly: true, fetch })).valid, false);
  const evil = ml_dsa65.keygen(new Uint8Array(32).fill(9));
  const forged = { ...att, mldsa_signature_b64: Buffer.from(ml_dsa65.sign(evil.secretKey, Buffer.from(digest, "hex"))).toString("base64") };
  assert.equal((await verifyAffixioAttestation(payload, forged, { kind: "verify", allowVkOnly: true, fetch })).valid, false);
  assert.equal(calls, 1, "key set cached");
  clearAffixioKeyCache();
  await assert.rejects(fetchAffixioKeys({ fetch: async () => { throw new Error("offline"); } }), (e) => e.code === "affixio_keys_unavailable");
  await assert.rejects(fetchAffixioKeys({ fetch: async () => ({ ok: true, json: async () => ({ schema: "affix.keys.v1", keys: [{ ...keySet.keys[0], secret_key_b64: "x" }] }) }) }), /secret material/);
});

test("replay guard: fresh once, replay rejected, window and future enforced", async () => {
  let now = 1_000_000;
  const guard = createReplayGuard({ windowMs: 60_000, clockSkewMs: 1_000, now: () => now, store: new MemoryReplayStore() });
  assert.deepEqual(await guard.check({ id: "cmd-1", issuedAtMs: now }), { ok: true, reason: "fresh" });
  assert.equal((await guard.check({ id: "cmd-1", issuedAtMs: now })).reason, "replay");
  assert.equal((await guard.check({ id: "cmd-2", issuedAtMs: now - 61_000 })).reason, "expired");
  assert.equal((await guard.check({ id: "cmd-3", issuedAtMs: now + 5_000 })).reason, "timestamp_in_future");
  assert.equal((await guard.check({ issuedAtMs: now })).reason, "missing_id");
  now += 30_000;
  assert.equal((await guard.check({ id: "cmd-1", issuedAtMs: now - 30_000 })).reason, "replay");
  assert.equal(typeof wfReplay, "function");
});
