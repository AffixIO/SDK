import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { canonical } from "./canonical.js";

const bytes = text => new TextEncoder().encode(text);
const decode = text => Uint8Array.from(atob(text), char => char.charCodeAt(0));
const hex = value => [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, "0")).join("");
export const sha256 = async value => hex(await crypto.subtle.digest("SHA-256", bytes(canonical(value))));

function trustedEntries(options) {
  // 2.0.0-beta.2: accepts trustedPublicKeys (base64 list, as before) and/or trustedKeys
  // (a published key set { keys: [...] }, a list of { key_id, public_key_b64 }, or a { key_id: b64 } map).
  const out = [];
  for (const k of options.trustedPublicKeys ?? []) out.push({ public_key_b64: String(k).trim() });
  const t = options.trustedKeys;
  if (t) {
    const list = Array.isArray(t) ? t : Array.isArray(t.keys) ? t.keys : typeof t === "string" ? [t]
      : t.public_key_b64 ? [t] : Object.entries(t).map(([key_id, public_key_b64]) => ({ key_id, public_key_b64 }));
    for (const k of list) {
      const entry = typeof k === "string" ? { public_key_b64: k.trim() } : k;
      if (entry?.algorithm && entry.algorithm !== "ML-DSA-65") continue;
      if (entry?.status === "revoked" || !entry?.public_key_b64) continue;
      out.push(entry);
    }
  }
  return out;
}

let legacyV1Warned = false;
async function bindingCheck(payload, { proof, circuitId, proofMode, decision, allowMissingDecision }) {
  if (typeof proof !== "string" || !payload || typeof payload !== "object") return { bound: false, reason: "envelope_proof_mismatch" };
  let ok = false;
  if (payload.proof !== undefined && typeof payload.proof !== "string") return { bound: false, reason: "envelope_proof_mismatch" };
  if (payload.proof_digest !== undefined && typeof payload.proof_digest !== "string") return { bound: false, reason: "envelope_proof_digest_mismatch" };
  if (typeof payload.proof === "string") ok = payload.proof === proof;
  else if (typeof payload.proof_digest === "string" && circuitId) {
    const d = payload.proof_digest.toLowerCase();
    for (const valid of [true, false]) if (hex(await crypto.subtle.digest("SHA-256", bytes(`${circuitId}:${valid}:${proof}`))) === d) ok = true;
  }
  if (!ok) return { bound: false, reason: "envelope_proof_mismatch" };
  if (typeof payload.circuit_id === "string") { if (payload.circuit_id !== circuitId) return { bound: false, reason: "envelope_circuit_mismatch" }; }
  else if (typeof payload.proof_mode === "string") { if (payload.proof_mode !== proofMode) return { bound: false, reason: "envelope_proof_mode_mismatch" }; }
  else return { bound: false, reason: "envelope_circuit_mismatch" };
  if (typeof payload.proof === "string" && typeof payload.proof_digest === "string" && circuitId) {
    const d = payload.proof_digest.toLowerCase(); let dm = false;
    for (const valid of [true, false]) if (hex(await crypto.subtle.digest("SHA-256", bytes(`${circuitId}:${valid}:${proof}`))) === d) dm = true;
    if (!dm) return { bound: false, reason: "envelope_proof_digest_mismatch" };
  }
  if (typeof decision === "string" && typeof payload.decision === "string" && payload.decision !== decision) return { bound: false, reason: "envelope_decision_mismatch" };
  // 2.0.2 (B17): a known decision must be signed in the envelope.
  if (typeof decision === "string" && payload.decision === undefined && !allowMissingDecision) return { bound: false, reason: "envelope_decision_missing" };
  if (payload.decision !== undefined && typeof payload.decision !== "string") return { bound: false, reason: "envelope_decision_mismatch" };
  return { bound: true };
}

async function verifyEnvelopeCore(envelope, options = {}) {
  const trusted = trustedEntries(options);
  if (!trusted.length && !options.insecureTrustEmbeddedKey) return { valid: false, reason: "no_trusted_keys", hmacVerified: false, zeroKnowledgeVerified: false };
  try {
    const attestation = envelope?.attestation;
    const v2 = attestation?.schema === "affix.local-signature.v2";
    if ((!v2 && attestation?.schema !== "affix.local-signature.v1") || attestation.algorithm !== "HMAC-SHA256+ML-DSA-65") return { valid: false, reason: "unsupported_signature" };
    // v2 signs canonical({ domain, key_id, payload, signed_at }) so signed_at is covered by the signature.
    if (v2 && !Number.isFinite(typeof attestation.signed_at === "string" ? Date.parse(attestation.signed_at) : NaN)) return { valid: false, reason: "invalid_signed_at" };
    const digest = hex(await crypto.subtle.digest("SHA-256", bytes(canonical(envelope.payload))));
    if (!v2 && options.rejectLegacyV1) return { valid: false, reason: "legacy_v1_rejected" };
    if (!v2 && !legacyV1Warned) { legacyV1Warned = true; (globalThis.process?.emitWarning ?? console.warn)("AffixIO: accepted a legacy v1 envelope (rejectLegacyV1: false). Re-sign as v2 and remove the opt-in.", { code: "AFFIXIO_LEGACY_V1_ACCEPTED" }); }
    const p = envelope.payload;
    if (!v2 && p && typeof p === "object" && !Array.isArray(p) && ("domain" in p || ("payload" in p && "signed_at" in p && "key_id" in p)))
      return { valid: false, reason: "legacy_v1_v2_shaped_payload" };
    // v2 bytes = fixed prefix + canonical(...): never equal to any v1 canonical(payload).
    const message = v2
      ? bytes("affix.sdk.local-signature.v2\n" + canonical({ domain: "affix.sdk.local-signature.v2", key_id: attestation.key_id, payload: envelope.payload, signed_at: attestation.signed_at }))
      : bytes(canonical(envelope.payload));
    if (options.proof !== undefined) {
      // proof binding: the envelope must commit to THIS proof, circuit and decision.
      const b = await bindingCheck(p, options);
      if (!b.bound) return { valid: false, reason: b.reason };
    }
    if (digest !== attestation.payload_digest) return { valid: false, reason: "digest_mismatch" };
    let key = null;
    if (trusted.length) {
      for (const entry of trusted) {
        const candidate = decode(entry.public_key_b64);
        const id = hex(await crypto.subtle.digest("SHA-256", candidate)).slice(0, 16);
        if (id !== attestation.key_id && entry.key_id !== attestation.key_id) continue;
        if (attestation.mldsa_public_key_b64 && attestation.mldsa_public_key_b64 !== entry.public_key_b64) continue;
        if (entry.not_before || entry.not_after || entry.status === "retired") {
          if (!v2 && !options.allowLegacyUnsignedTime) return { valid: false, reason: "unsigned_timestamp" };
          if (!v2) console.warn("AffixIO: allowLegacyUnsignedTime accepted an unsigned signing time. Migration only.");
          const at = Date.parse(attestation.signed_at);
          if (!Number.isFinite(at) || (entry.not_before && !(Date.parse(entry.not_before) <= at)) || (entry.not_after && !(Date.parse(entry.not_after) >= at)))
            return { valid: false, reason: "key_outside_validity_window" };
        }
        key = candidate; break;
      }
      if (!key) return { valid: false, reason: "untrusted_signer" };
    } else {
      console.warn("AffixIO: insecureTrustEmbeddedKey is enabled. Use only in tests.");
      key = decode(attestation.mldsa_public_key_b64);
      if (hex(await crypto.subtle.digest("SHA-256", key)).slice(0, 16) !== attestation.key_id) return { valid: false, reason: "digest_mismatch" };
    }
    const valid = ml_dsa65.verify(key, message, decode(attestation.mldsa_signature_b64));
    return { valid, reason: valid ? "trusted_mldsa_signature" : "invalid_signature", hmacVerified: false, zeroKnowledgeVerified: false };
  } catch { return { valid: false, reason: "malformed_envelope" }; }
}

let unboundWarned = false;
/**
 * 2.0.0-beta.5: binding is required. Pass { proof, circuitId } (and optionally decision), or
 * allowUnbound: true to verify the signature only; the result is then marked unbound.
 * Legacy v1 envelopes are rejected unless rejectLegacyV1: false.
 * Result always carries bound (boolean) and binding ("checked" | "skipped" | "missing").
 */
export async function verifyPublicEnvelope(envelope, options = {}) {
  const opts = { ...options, rejectLegacyV1: options.rejectLegacyV1 ?? true };
  if (!trustedEntries(opts).length && !opts.insecureTrustEmbeddedKey) return { valid: false, reason: "no_trusted_keys", bound: false, binding: "missing", hmacVerified: false, zeroKnowledgeVerified: false };
  if (opts.proof === undefined) {
    if (!opts.allowUnbound) return { valid: false, reason: "binding_required", bound: false, binding: "missing", hmacVerified: false, zeroKnowledgeVerified: false };
    if (!unboundWarned) { unboundWarned = true; console.warn("AffixIO: verifyPublicEnvelope allowUnbound: signature checked, but the envelope is NOT bound to a proof."); }
    const r = await verifyEnvelopeCore(envelope, opts);
    return { ...r, bound: false, binding: "skipped", unbound: true };
  }
  if (!opts.circuitId && !opts.proofMode) return { valid: false, reason: "binding_needs_circuit", bound: false, binding: "missing", hmacVerified: false, zeroKnowledgeVerified: false };
  const r = await verifyEnvelopeCore(envelope, opts);
  return { ...r, bound: r.valid === true, binding: "checked" };
}

export async function verifyEvidenceBundle(bundle, options = {}) {
  try {
    if (bundle?.manifest?.schema !== "affix.evidence.v1" || !Array.isArray(bundle.artifacts) || !Array.isArray(bundle.manifest.entries)) throw new Error("Invalid bundle");
    if (bundle.artifacts.length !== bundle.manifest.entries.length) throw new Error("Manifest length mismatch");
    const names = new Set();
    for (let i = 0; i < bundle.artifacts.length; i++) {
      const artifact = bundle.artifacts[i];
      const entry = bundle.manifest.entries[i];
      if (names.has(artifact.name) || artifact.name !== entry.name || await sha256(artifact.data) !== entry.digest) throw new Error("Artifact mismatch");
      names.add(artifact.name);
    }
    let signature = { valid: false, reason: "unsigned_manifest" };
    if (bundle.signature) signature = await verifyEnvelopeCore({ payload: bundle.manifest, attestation: bundle.signature }, { ...options, proof: undefined, rejectLegacyV1: options.rejectLegacyV1 ?? true });
    return { integrityValid: true, signatureValid: signature.valid, reason: signature.reason,
      artifactCount: bundle.artifacts.length, zeroKnowledgeVerified: false, remoteAttestationVerified: false };
  } catch {
    return { integrityValid: false, signatureValid: false, reason: "invalid_bundle", artifactCount: 0, zeroKnowledgeVerified: false, remoteAttestationVerified: false };
  }
}

export function renderEvidenceSummary(element, result) {
  const document = element.ownerDocument;
  const heading = document.createElement("h2");
  heading.textContent = "Evidence verification";
  const list = document.createElement("dl");
  for (const [name, value] of [["Bundle integrity", result.integrityValid ? "Valid" : "Invalid"],
    ["Trusted signature", result.signatureValid ? "Verified" : "Not verified"],
    ["Zero-knowledge proof", "Not checked by this viewer"], ["Artifacts", String(result.artifactCount)]]) {
    const dt = document.createElement("dt"), dd = document.createElement("dd");
    dt.textContent = name; dd.textContent = value; list.append(dt, dd);
  }
  element.replaceChildren(heading, list);
}
