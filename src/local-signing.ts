/* Credit: @paparichens */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa";
export type LocalSigningKeyPair = {
    algorithm: "ML-DSA-65";
    public_key_b64: string;
    secret_key_b64: string;
    key_id: string;
};

export type LocalAttestation = {
    schema: "affix.local-signature.v1";
    algorithm: "HMAC-SHA256+ML-DSA-65";
    signed_at: string;
    payload_digest: string;
    key_id: string;
    hmac_b64: string;
    mldsa_signature_b64: string;
    mldsa_public_key_b64: string;
};

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

export function canonicalLocalPayload(payload: unknown): string {
    return JSON.stringify(canonicalValue(payload, new Set()));
}

export function createLocalSigningKeyPair(seedB64?: string): LocalSigningKeyPair {
    const seedBytes = seedB64
        ? Buffer.from(seedB64, "base64")
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

export function signLocalPayload(payload: unknown, options: {
    hmacSecret: string;
    secretKeyB64: string;
    publicKeyB64: string;
}): LocalAttestation {
    const canonical = canonicalLocalPayload(payload);
    const message = Buffer.from(canonical, "utf8");
    const secretKey = Buffer.from(options.secretKeyB64, "base64");
    const publicKey = Buffer.from(options.publicKeyB64, "base64");
    const payloadDigest = createHash("sha256").update(message).digest("hex");
    const hmac = createHmac("sha256", localHmacKey(options.hmacSecret))
        .update(message)
        .digest();
    const signature = ml_dsa65.sign(secretKey, message);
    return {
        schema: "affix.local-signature.v1",
        algorithm: "HMAC-SHA256+ML-DSA-65",
        signed_at: new Date().toISOString(),
        payload_digest: payloadDigest,
        key_id: createHash("sha256").update(publicKey).digest("hex").slice(0, 16),
        hmac_b64: hmac.toString("base64"),
        mldsa_signature_b64: Buffer.from(signature).toString("base64"),
        mldsa_public_key_b64: publicKey.toString("base64"),
    };
}

export function verifyLocalPayload(payload: unknown, attestation: LocalAttestation, hmacSecret: string): boolean {
    try {
        if (attestation?.schema !== "affix.local-signature.v1")
            return false;
        const canonical = canonicalLocalPayload(payload);
        const message = Buffer.from(canonical, "utf8");
        const digest = createHash("sha256").update(message).digest("hex");
        if (digest !== attestation.payload_digest)
            return false;
        const expectedHmac = createHmac("sha256", localHmacKey(hmacSecret))
            .update(message)
            .digest();
        const suppliedHmac = Buffer.from(attestation.hmac_b64, "base64");
        if (expectedHmac.length !== suppliedHmac.length ||
            !timingSafeEqual(expectedHmac, suppliedHmac))
            return false;
        const publicKey = Buffer.from(attestation.mldsa_public_key_b64, "base64");
        const keyId = createHash("sha256").update(publicKey).digest("hex").slice(0, 16);
        if (keyId !== attestation.key_id)
            return false;
        const signature = Buffer.from(attestation.mldsa_signature_b64, "base64");
        return ml_dsa65.verify(publicKey, message, signature);
    }
    catch {
        return false;
    }
}
