/* Credit: @paparichens */
// Official AffixIO verification keys (public only) and AffixIO server attestation verify.
import { createHash } from "node:crypto";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa";
import { AffixTrustError, normalizeTrustedKeys, warnLegacyUnsignedTime } from "./local-signing.js";

export const AFFIXIO_KEYS_URL = "https://api.affix-io.com/v1/keys";
export const AFFIXIO_KEYS_WELL_KNOWN_URL = "https://api.affix-io.com/.well-known/affixio-keys.json";

let cache = null; // { url, at, keySet }

/** Key set URL for an API base (default: AFFIX_API_BASE, else https://api.affix-io.com). */
export function affixioKeysUrl(apiBase) {
    const raw = (apiBase ?? process.env.AFFIX_API_BASE ?? "https://api.affix-io.com").trim().replace(/\/+$/, "");
    return `${raw || "https://api.affix-io.com"}/v1/keys`;
}

function canonicalJson(value) {
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(",")}]`;
    if (value && typeof value === "object")
        return `{${Object.keys(value).sort().filter((k) => value[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
    return JSON.stringify(value);
}

/**
 * Stable hash of a key set for offline pinning: SHA-256 (hex) of the canonical JSON of
 * [{ key_id, algorithm, public_key_b64, status, not_before, not_after }] sorted by key_id.
 */
export function computeKeySetHash(keySet) {
    const keys = (Array.isArray(keySet) ? keySet : keySet?.keys ?? [])
        .map((k) => ({ key_id: k.key_id, algorithm: k.algorithm, public_key_b64: k.public_key_b64, status: k.status ?? null, not_before: k.not_before ?? null, not_after: k.not_after ?? null }))
        .sort((a, b) => String(a.key_id).localeCompare(String(b.key_id)));
    return createHash("sha256").update(canonicalJson(keys)).digest("hex");
}

/** Hash of one public key (SHA-256 hex of the raw key bytes); stable across key_id formats. */
export function publicKeyHash(publicKeyB64) {
    return createHash("sha256").update(Buffer.from(publicKeyB64, "base64")).digest("hex");
}

let keyIdsWarned = false;
function warnKeyIdsOnly() {
    if (keyIdsWarned)
        return;
    keyIdsWarned = true;
    process.emitWarning?.("AffixIO: expectedKeyIds only checks that ids are present; extra or swapped keys still pass. Pin with expectedKeys [{ key_id, public_key_hash }] or expectedKeySetHash.", { code: "AFFIXIO_KEY_IDS_NOT_A_PIN" });
}

function assertPinnedKeySet(keySet, options) {
    if (options.expectedKeySetHash && computeKeySetHash(keySet) !== String(options.expectedKeySetHash).toLowerCase())
        throw new AffixTrustError("affixio_keyset_pin_mismatch", "Fetched AffixIO key set does not match expectedKeySetHash");
    if (options.expectedKeys?.length) {
        // 2.0.0-beta.4 byte pinning: every key in the fetched set must be pinned, by key_id AND
        // SHA-256 of its raw public key bytes. Unexpected extra keys are REJECTED (fail closed),
        // not ignored, so a tampered set is noticed rather than silently trimmed.
        const pins = new Map();
        for (const pin of options.expectedKeys) {
            if (!pin?.key_id || !/^[0-9a-f]{64}$/i.test(String(pin.public_key_hash ?? "")))
                throw new AffixTrustError("invalid_key_pin", "expectedKeys entries need key_id and public_key_hash (64 hex chars, SHA-256 of raw key bytes)");
            pins.set(String(pin.key_id), String(pin.public_key_hash).toLowerCase());
        }
        let matched = 0;
        for (const k of keySet.keys) {
            const want = pins.get(k.key_id);
            if (!want)
                throw new AffixTrustError("affixio_keyset_pin_mismatch", `Fetched AffixIO key set contains unpinned key ${k.key_id}`);
            if (publicKeyHash(k.public_key_b64) !== want)
                throw new AffixTrustError("affixio_keyset_pin_mismatch", `Key bytes for ${k.key_id} do not match the pinned public_key_hash`);
            matched++;
        }
        if (matched === 0)
            throw new AffixTrustError("affixio_keyset_pin_mismatch", "Fetched AffixIO key set contains none of the pinned keys");
    }
    if (options.expectedKeyIds?.length) {
        // NOT a security control on its own: it only checks presence. Use expectedKeys or expectedKeySetHash.
        if (!options.expectedKeys?.length && !options.expectedKeySetHash)
            warnKeyIdsOnly();
        const ids = new Set(keySet.keys.map((k) => k.key_id));
        const hashes = new Set(keySet.keys.map((k) => publicKeyHash(k.public_key_b64)));
        for (const id of options.expectedKeyIds)
            if (!ids.has(id) && !hashes.has(String(id).toLowerCase()))
                throw new AffixTrustError("affixio_keyset_pin_mismatch", `Fetched AffixIO key set is missing pinned key ${id}`);
    }
}

function validateKeySet(doc) {
    if (!doc || doc.schema !== "affix.keys.v1" || !Array.isArray(doc.keys) || doc.keys.length === 0)
        throw new AffixTrustError("affixio_keys_invalid", "AffixIO key set has an unexpected shape");
    const keys = doc.keys.filter((k) => k && k.algorithm === "ML-DSA-65" && k.status !== "revoked");
    // Throws if any key is not a valid ML-DSA-65 public key.
    normalizeTrustedKeys(keys);
    for (const k of keys) {
        if (k.secret_key_b64 || k.secretKey || k.secret_key)
            throw new AffixTrustError("affixio_keys_invalid", "Key set contains secret material; refusing it");
    }
    return { ...doc, keys };
}

/**
 * Fetch the official AffixIO public key set once and cache it (default 1 hour).
 * Pass the result as trustedKeys, or save it to disk and pin it on offline devices.
 * Throws AffixTrustError("affixio_keys_unavailable") if it cannot be loaded.
 */
export async function fetchAffixioKeys(options = {}) {
    // 2.0.3 (F2): the keys URL follows options.apiBase / AFFIX_API_BASE; never a silent production fallback.
    const url = options.url ?? affixioKeysUrl(options.apiBase);
    const ttlMs = options.ttlMs ?? 3_600_000;
    if (!options.force && cache && cache.url === url && Date.now() - cache.at < ttlMs) {
        assertPinnedKeySet(cache.keySet, options);
        return cache.keySet;
    }
    const doFetch = options.fetch ?? globalThis.fetch;
    if (typeof doFetch !== "function")
        throw new AffixTrustError("affixio_keys_unavailable", "No fetch available to load AffixIO keys; pass trustedKeys explicitly");
    let doc;
    try {
        const res = await doFetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout?.(options.timeoutMs ?? 10_000) });
        if (!res.ok)
            throw new Error(`HTTP ${res.status}`);
        doc = await res.json();
    }
    catch (err) {
        throw new AffixTrustError("affixio_keys_unavailable", `Could not load AffixIO keys from ${url}: ${err instanceof Error ? err.message : err}. Pin a saved key set with trustedKeys for offline use.`);
    }
    const keySet = validateKeySet(doc);
    assertPinnedKeySet(keySet, options);
    cache = { url, at: Date.now(), keySet };
    return keySet;
}

export function clearAffixioKeyCache() {
    cache = null;
}

/**
 * Verify an attestation signed by the AffixIO API (POST /api/attest and similar):
 * message = SHA-256(JSON.stringify(payload)), signed with the AffixIO ML-DSA-65 key.
 * Uses options.trustedKeys if given, otherwise the cached official key set.
 * Never trusts a public key carried in the response itself.
 */
/** Domain the API puts inside POST /v1/attest/proof signed cores (server-verified proof attestations). */
export const VERIFIED_PROOF_DOMAIN = "affixio.attest.verified-proof.v1";
/** Domain of POST /api/attest client-payload signatures (never proof of validity). */
export const CLIENT_PAYLOAD_DOMAIN = "affixio.attest.client-payload.v1";
const ATTESTATION_KINDS = new Set(["proof", "verify", "prove", "any"]);

/**
 * 2.0.3: what the signed payload claims to be. Checked before the signature so a validly signed
 * object of one kind can never be presented as another.
 *  - "proof" (default): a /v1/attest/proof core; requires domain VERIFIED_PROOF_DOMAIN and
 *    server_verified === true (and circuit_id === expectedCircuitId when given).
 *  - "verify" / "prove": a /v1/circuits/:id/verify or /prove response core (signedVerifyPayload());
 *    these carry no domain, so any payload with a domain field is refused.
 *  - "any": signature check only (old 2.0.2 behaviour). Never use it to decide that AffixIO verified something.
 */
function attestationKindCheck(payload, options) {
    const kind = options.kind ?? "proof";
    if (!ATTESTATION_KINDS.has(kind))
        return "unknown_attestation_kind";
    if (kind === "any")
        return null;
    const domain = payload && typeof payload === "object" ? payload.domain : undefined;
    if (kind === "proof") {
        if (domain !== VERIFIED_PROOF_DOMAIN)
            return domain === CLIENT_PAYLOAD_DOMAIN ? "client_payload_not_proof" : "not_verified_proof_attestation";
        if (payload.server_verified !== true)
            return "not_server_verified";
        // Server fix 2026-10-11: cores signed before circuit binding (no circuit_binding field) could
        // name a circuit the proof was not made for, so they are not accepted as proof attestations.
        if (payload.circuit_binding !== "server_prove_record" && payload.circuit_binding !== "unique_vk")
            return "circuit_not_bound";
        if (options.expectedCircuitId !== undefined && payload.circuit_id !== options.expectedCircuitId)
            return "circuit_mismatch";
        return null;
    }
    if (domain !== undefined)
        return domain === CLIENT_PAYLOAD_DOMAIN ? "client_payload_not_proof" : "unexpected_domain";
    // 2.0.3 (vk_only): a /verify core only names a proven circuit when the server bound it
    // (server_prove_record or unique_vk). vk_only cores, and cores signed before 2026-10-11 that
    // carry no circuit_binding, may name a circuit the proof was not made for.
    if (kind === "verify" && !options.allowVkOnly) {
        const b = payload?.circuit_binding;
        if (b !== "server_prove_record" && b !== "unique_vk")
            return "circuit_not_bound";
    }
    if (options.expectedCircuitId !== undefined && payload?.circuit_id !== options.expectedCircuitId)
        return "circuit_mismatch";
    if (options.expectedCircuitId !== undefined && typeof payload?.bound_circuit_id === "string" && payload.bound_circuit_id !== options.expectedCircuitId)
        return "circuit_mismatch";
    return null;
}

export async function verifyAffixioAttestation(payload, attestation, options = {}) {
    const kindError = attestationKindCheck(payload, options);
    if (kindError)
        return { valid: false, reason: kindError, key_id: null, kind: options.kind ?? "proof" };
    const keySource = options.trustedKeys ?? await fetchAffixioKeys(options);
    const trusted = normalizeTrustedKeys(keySource);
    if (trusted.size === 0)
        throw new AffixTrustError("no_trusted_keys", "No AffixIO verification key available");
    try {
        if (attestation?.algorithm && attestation.algorithm !== "ML-DSA-65")
            return { valid: false, reason: "unsupported_signature", key_id: null };
        const digest = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
        if (digest !== attestation?.payload_digest)
            return { valid: false, reason: "digest_mismatch", key_id: null };
        const message = Buffer.from(digest, "hex");
        const signature = Buffer.from(String(attestation.mldsa_signature_b64 ?? ""), "base64");
        const records = attestation.key_id && trusted.has(attestation.key_id)
            ? [trusted.get(attestation.key_id)]
            : [...new Set(trusted.values())];
        // 2.0.0-beta.3: AffixIO API attestations carry an UNSIGNED signed_at (the server signs only
        // SHA-256(JSON.stringify(payload))). It is never used for key validity. Instead:
        //  - revoked keys are rejected;
        //  - retired keys, or keys with not_after, cannot be shown to have signed inside their window,
        //    so they are rejected unless allowLegacyUnsignedTime is set;
        //  - not_before is checked against the verifier's clock;
        //  - requireSignedTime: true rejects every API attestation (none carry a signed time).
        if (options.requireSignedTime)
            return { valid: false, reason: "unsigned_timestamp", key_id: null };
        const nowMs = options.now ? options.now() : Date.now();
        let windowBlocked = false;
        for (const record of records) {
            if (record.status === "revoked")
                continue;
            const windowed = record.status === "retired" || record.not_after;
            if (windowed && !options.allowLegacyUnsignedTime) {
                if (ml_dsa65.verify(record.bytes, message, signature))
                    windowBlocked = true;
                continue;
            }
            if (windowed)
                warnLegacyUnsignedTime();
            if (record.not_before && !(Date.parse(record.not_before) <= nowMs))
                continue;
            if (ml_dsa65.verify(record.bytes, message, signature))
                return { valid: true, reason: "trusted_affixio_signature", key_id: record.published_key_id ?? record.key_id, key_id_alias: record.key_id, public_key_hash: publicKeyHash(Buffer.from(record.bytes).toString("base64")), signed_time: false };
        }
        if (windowBlocked)
            return { valid: false, reason: "unsigned_timestamp", key_id: null };
        return { valid: false, reason: "untrusted_or_invalid_signature", key_id: null };
    }
    catch {
        return { valid: false, reason: "malformed_attestation", key_id: null };
    }
}

/**
 * 2.0.3 (F3): the object the API's /verify attestation covers: the response as received,
 * in its original key order, minus the attestation and the Merkle fields added after signing.
 */
export function signedVerifyPayload(response) {
    // 2.0.3: /prove (and any endpoint that returns it) gives the exact signed core as signed_payload.
    if (response && typeof response.signed_payload === "object" && response.signed_payload !== null)
        return response.signed_payload;
    const out = {};
    for (const [k, v] of Object.entries(response ?? {})) {
        if (k === "attestation" || k === "merkle_root" || k === "merkle_leaf_hash" || k === "merkle_index" || k === "merkle_inclusion")
            continue;
        out[k] = v;
    }
    return out;
}
