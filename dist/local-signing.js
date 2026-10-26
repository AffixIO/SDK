/* Credit: @paparichens */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";

const DOMAIN = "affix.sdk.local-signature.v1";

function canonicalValue(value, seen) {
    if (value === null || typeof value === "string" || typeof value === "boolean")
        return value;
    if (typeof value === "number") {
        if (!Number.isFinite(value))
            throw new TypeError("local_signing_non_finite_number");
        return value;
    }
    if (typeof value === "bigint")
        return value.toString();
    if (Array.isArray(value))
        return value.map((item) => canonicalValue(item, seen));
    if (typeof value !== "object")
        throw new TypeError(`local_signing_unsupported_type:${typeof value}`);
    if (seen.has(value))
        throw new TypeError("local_signing_circular_payload");
    seen.add(value);
    const out = {};
    for (const key of Object.keys(value).sort()) {
        if (value[key] !== undefined)
            out[key] = canonicalValue(value[key], seen);
    }
    seen.delete(value);
    return out;
}

export function canonicalLocalPayload(payload) {
    return JSON.stringify(canonicalValue(payload, new Set()));
}

export function createLocalSigningKeyPair(seed) {
    const seedBytes = seed
        ? Buffer.from(seed, "base64")
        : randomBytes(32);
    if (seedBytes.length !== 32)
        throw new TypeError("mldsa65_seed_must_be_32_bytes");
    const keys = ml_dsa65.keygen(seedBytes);
    return {
        algorithm: "ML-DSA-65",
        public_key_b64: Buffer.from(keys.publicKey).toString("base64"),
        secret_key_b64: Buffer.from(keys.secretKey).toString("base64"),
        key_id: createHash("sha256").update(keys.publicKey).digest("hex").slice(0, 16),
    };
}

function localHmacKey(secret) {
    if (typeof secret !== "string" || secret.length < 16)
        throw new TypeError("local_hmac_secret_must_be_at_least_16_characters");
    return createHmac("sha256", secret).update(DOMAIN).digest();
}

export const LOCAL_SIGNATURE_SCHEMA_V1 = "affix.local-signature.v1";
export const LOCAL_SIGNATURE_SCHEMA_V2 = "affix.local-signature.v2";
const DOMAIN_V2 = "affix.sdk.local-signature.v2";
// 2.0.0-beta.4: fixed prefix that canonical JSON can never produce (canonical JSON starts with
// '{', '[', '"', a digit, '-', 't', 'f' or 'n'), so no v1 message can equal a v2 message.
export const LOCAL_SIGNATURE_V2_PREFIX = "affix.sdk.local-signature.v2\n";

/**
 * Bytes covered by the signature. v2 (2.0.0-beta.3 default) binds signed_at and key_id
 * into the signed message, so the signing time cannot be edited or removed:
 *   "affix.sdk.local-signature.v2\n" + canonical({ domain: "affix.sdk.local-signature.v2", key_id, payload, signed_at })
 * v1 (legacy) signs canonical(payload) only.
 */
export function localSignatureMessage(payload, attestation) {
    if (attestation?.schema === LOCAL_SIGNATURE_SCHEMA_V2) {
        return Buffer.from(LOCAL_SIGNATURE_V2_PREFIX + canonicalLocalPayload({ domain: DOMAIN_V2, key_id: attestation.key_id, payload, signed_at: attestation.signed_at }), "utf8");
    }
    return Buffer.from(canonicalLocalPayload(payload), "utf8");
}

function looksLikeV2Message(payload) {
    if (typeof payload === "string")
        return payload.startsWith(LOCAL_SIGNATURE_V2_PREFIX) || payload.includes(DOMAIN_V2);
    return Boolean(payload && typeof payload === "object" && !Array.isArray(payload) &&
        ("domain" in payload || ("payload" in payload && "signed_at" in payload && "key_id" in payload)));
}

export function signLocalPayload(payload, options) {
    if (options.legacyV1 && looksLikeV2Message(payload))
        throw new TypeError("legacy_v1_refused: payload has a top-level 'domain' or looks like a v2 signed message");
    const payloadMessage = Buffer.from(canonicalLocalPayload(payload), "utf8");
    const secretKey = Buffer.from(options.secretKeyB64, "base64");
    const publicKey = Buffer.from(options.publicKeyB64, "base64");
    const payloadDigest = createHash("sha256").update(payloadMessage).digest("hex");
    const head = {
        schema: options.legacyV1 ? LOCAL_SIGNATURE_SCHEMA_V1 : LOCAL_SIGNATURE_SCHEMA_V2,
        algorithm: "HMAC-SHA256+ML-DSA-65",
        signed_at: options.signedAt ?? new Date().toISOString(),
        payload_digest: payloadDigest,
        key_id: createHash("sha256").update(publicKey).digest("hex").slice(0, 16),
    };
    const message = localSignatureMessage(payload, head);
    const hmac = createHmac("sha256", localHmacKey(options.hmacSecret)).update(message).digest();
    const signature = ml_dsa65.sign(secretKey, message);
    return {
        ...head,
        hmac_b64: hmac.toString("base64"),
        mldsa_signature_b64: Buffer.from(signature).toString("base64"),
        mldsa_public_key_b64: publicKey.toString("base64"),
    };
}

/**
 * Error raised when ML-DSA verification has no trusted key to check against.
 * Verification fails closed: the public key embedded in an attestation is never
 * trusted on its own.
 */
export class AffixTrustError extends Error {
    code;
    constructor(code, message) {
        super(message ?? code);
        this.name = "AffixTrustError";
        this.code = code;
    }
}

const MLDSA65_PUBLIC_KEY_BYTES = 1952;
let embeddedKeyWarned = false;

function localKeyId(bytes) {
    return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

function decodePublicKey(value) {
    if (value instanceof Uint8Array)
        return Buffer.from(value);
    if (typeof value !== "string")
        return null;
    const text = value.trim();
    const bytes = /^(0x)?[0-9a-fA-F]+$/.test(text) && text.replace(/^0x/, "").length === MLDSA65_PUBLIC_KEY_BYTES * 2
        ? Buffer.from(text.replace(/^0x/, ""), "hex")
        : Buffer.from(text, "base64");
    return bytes.length === MLDSA65_PUBLIC_KEY_BYTES ? bytes : null;
}

function addKey(map, entry, fallbackId) {
    let bytes = null;
    let meta = {};
    if (typeof entry === "string" || entry instanceof Uint8Array) {
        bytes = decodePublicKey(entry);
    }
    else if (entry && typeof entry === "object") {
        if (entry.algorithm && entry.algorithm !== "ML-DSA-65")
            return;
        bytes = decodePublicKey(entry.public_key_b64 ?? entry.publicKeyB64 ?? entry.public_key_hex ?? entry.publicKey ?? entry.public_key);
        meta = { status: entry.status, not_before: entry.not_before, not_after: entry.not_after };
        fallbackId = entry.key_id ?? entry.keyId ?? fallbackId;
    }
    if (!bytes)
        throw new AffixTrustError("invalid_trusted_key", "Trusted key is not a valid ML-DSA-65 public key (1952 bytes, base64 or hex)");
    const record = { bytes, key_id: localKeyId(bytes), ...meta };
    // 2.0.3 (F6): remember the published id (e.g. "mldsa65-1bf342d458b982b2" from /v1/keys) so
    // AffixIO attestation results can report it; key_id stays the hash-derived local id (alias).
    if (fallbackId && String(fallbackId) !== record.key_id)
        record.published_key_id = String(fallbackId);
    map.set(record.key_id, record);
    if (fallbackId && fallbackId !== record.key_id)
        map.set(String(fallbackId), record);
}

/**
 * Normalise trusted ML-DSA-65 public keys into a Map keyed by key_id.
 * Accepts: one key (base64/hex string or bytes), an object { key_id, public_key_b64 },
 * an array of either, a { key_id: public_key_b64 } map, or a published key set
 * document such as GET https://api.affix-io.com/v1/keys ({ keys: [...] }).
 */
export function normalizeTrustedKeys(input) {
    const map = new Map();
    if (input === undefined || input === null || input === false)
        return map;
    if (input instanceof Map) {
        for (const [id, entry] of input)
            addKey(map, entry, id);
        return map;
    }
    if (Array.isArray(input)) {
        for (const entry of input)
            addKey(map, entry);
        return map;
    }
    if (typeof input === "string" || input instanceof Uint8Array) {
        addKey(map, input);
        return map;
    }
    if (typeof input === "object") {
        if (Array.isArray(input.keys)) {
            for (const entry of input.keys)
                addKey(map, entry);
            return map;
        }
        if (input.public_key_b64 || input.publicKeyB64 || input.public_key_hex || input.publicKey) {
            addKey(map, input);
            return map;
        }
        for (const [id, entry] of Object.entries(input))
            addKey(map, entry, id);
        return map;
    }
    throw new AffixTrustError("invalid_trusted_keys", "trustedKeys must be a key, a key list, a key_id map or a key set document");
}

function windowApplies(record) {
    return Boolean(record.not_before || record.not_after || record.status === "retired");
}

/** Validity check against a SIGNED time. Unparseable times fail closed. */
function withinWindow(record, signedAt) {
    const at = typeof signedAt === "string" ? Date.parse(signedAt) : NaN;
    if (!Number.isFinite(at))
        return false;
    if (record.not_before && !(Date.parse(record.not_before) <= at))
        return false;
    if (record.not_after && !(Date.parse(record.not_after) >= at))
        return false;
    return true;
}

let legacyTimeWarned = false;
export function warnLegacyUnsignedTime() {
    if (legacyTimeWarned)
        return;
    legacyTimeWarned = true;
    process.emitWarning?.("AffixIO: allowLegacyUnsignedTime accepted a signature whose signing time is NOT signed. Key validity windows are not enforced for it. Migration only.", { code: "AFFIXIO_ALLOW_LEGACY_UNSIGNED_TIME" });
}

function warnEmbeddedKey() {
    if (embeddedKeyWarned)
        return;
    embeddedKeyWarned = true;
    process.emitWarning?.("AffixIO: insecureTrustEmbeddedKey is enabled. Any ML-DSA key pair can produce envelopes that pass. Use only in tests.", { code: "AFFIXIO_INSECURE_TRUST_EMBEDDED_KEY" });
}

/**
 * Verify a local attestation against pinned keys. Returns a detailed result.
 * options.trustedKeys: pinned key(s), required unless options.insecureTrustEmbeddedKey.
 * options.hmacSecret: also check the HMAC (trusted-party verifiers only).
 * options.requireHmac: fail if no hmacSecret was supplied.
 * Throws AffixTrustError("no_trusted_keys") when no trust is configured.
 */
export function verifyLocalAttestation(payload, attestation, options = {}) {
    const trusted = normalizeTrustedKeys(options.trustedKeys);
    if (trusted.size === 0 && !options.insecureTrustEmbeddedKey) {
        throw new AffixTrustError("no_trusted_keys", "No trusted ML-DSA-65 key configured. Pass trustedKeys (your own local public key, or the AffixIO key set from GET https://api.affix-io.com/v1/keys). The key embedded in an envelope is never trusted by default.");
    }
    const fail = (reason) => ({ valid: false, reason, key_id: attestation?.key_id ?? null, hmacVerified: false, signatureVerified: false });
    try {
        const schema = attestation?.schema;
        if (schema !== LOCAL_SIGNATURE_SCHEMA_V1 && schema !== LOCAL_SIGNATURE_SCHEMA_V2)
            return fail("unsupported_signature");
        const signedTime = schema === LOCAL_SIGNATURE_SCHEMA_V2;
        // 2.0.0-beta.5: standalone default rejects legacy v1; opt in with rejectLegacyV1: false.
        if (!signedTime && (options.rejectLegacyV1 ?? true))
            return fail("legacy_v1_rejected");
        if (!signedTime)
            warnLegacyV1Accepted();
        if (!signedTime && looksLikeV2Message(payload))
            return fail("legacy_v1_v2_shaped_payload");
        if (signedTime && !Number.isFinite(typeof attestation.signed_at === "string" ? Date.parse(attestation.signed_at) : NaN))
            return fail("invalid_signed_at");
        const digest = createHash("sha256").update(canonicalLocalPayload(payload), "utf8").digest("hex");
        if (digest !== attestation.payload_digest)
            return fail("digest_mismatch");
        const message = localSignatureMessage(payload, attestation);
        let hmacVerified = false;
        if (options.hmacSecret !== undefined && options.hmacSecret !== null) {
            const expectedHmac = createHmac("sha256", localHmacKey(options.hmacSecret)).update(message).digest();
            const suppliedHmac = Buffer.from(String(attestation.hmac_b64 ?? ""), "base64");
            if (expectedHmac.length !== suppliedHmac.length || !timingSafeEqual(expectedHmac, suppliedHmac))
                return fail("hmac_mismatch");
            hmacVerified = true;
        }
        else if (options.requireHmac) {
            return fail("hmac_secret_required");
        }
        const embedded = attestation.mldsa_public_key_b64 ? Buffer.from(attestation.mldsa_public_key_b64, "base64") : null;
        let key;
        if (trusted.size > 0) {
            const record = trusted.get(String(attestation.key_id));
            if (!record)
                return fail("untrusted_signer");
            if (embedded && !embedded.equals(record.bytes))
                return fail("untrusted_signer");
            if (record.status === "revoked")
                return fail("key_revoked");
            if (windowApplies(record)) {
                // v1 envelopes carry an unsigned signed_at that an attacker can edit or delete.
                if (!signedTime && !options.allowLegacyUnsignedTime)
                    return fail("unsigned_timestamp");
                if (!signedTime)
                    warnLegacyUnsignedTime();
                if (!withinWindow(record, attestation.signed_at))
                    return fail("key_outside_validity_window");
            }
            key = record.bytes;
        }
        else {
            warnEmbeddedKey();
            if (!embedded || localKeyId(embedded) !== attestation.key_id)
                return fail("key_id_mismatch");
            key = embedded;
        }
        const signature = Buffer.from(String(attestation.mldsa_signature_b64 ?? ""), "base64");
        const ok = ml_dsa65.verify(key, message, signature);
        return ok
            ? { valid: true, reason: trusted.size > 0 ? "trusted_mldsa_signature" : "insecure_embedded_key_signature", key_id: attestation.key_id, hmacVerified, signatureVerified: true }
            : fail("invalid_signature");
    }
    catch (err) {
        if (err instanceof AffixTrustError)
            throw err;
        return fail("malformed_attestation");
    }
}

/**
 * Boolean form. Signature: verifyLocalPayload(payload, attestation, hmacSecret, { trustedKeys })
 * or verifyLocalPayload(payload, attestation, { hmacSecret, trustedKeys }).
 * 2.0.0-beta.2: throws AffixTrustError when no trusted key is configured (breaking).
 */
export function verifyLocalPayload(payload, attestation, hmacSecretOrOptions, maybeOptions = {}) {
    const options = typeof hmacSecretOrOptions === "object" && hmacSecretOrOptions !== null
        ? hmacSecretOrOptions
        : { ...maybeOptions, hmacSecret: hmacSecretOrOptions, requireHmac: maybeOptions.requireHmac ?? hmacSecretOrOptions !== undefined };
    return verifyLocalAttestation(payload, attestation, options).valid;
}

let legacyV1Warned = false;
/** 2.0.3: accepting a v1 envelope (rejectLegacyV1: false) warns once per process. */
export function warnLegacyV1Accepted() {
    if (legacyV1Warned)
        return;
    legacyV1Warned = true;
    process.emitWarning?.("AffixIO: accepted a legacy v1 envelope (rejectLegacyV1: false). v1 does not sign signed_at; re-sign stored envelopes as v2 and remove the opt-in.", { code: "AFFIXIO_LEGACY_V1_ACCEPTED" });
}
