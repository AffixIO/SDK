#!/usr/bin/env node
/* Credit: @paparichens */
// 2.0.0-beta.2: verify-offline runs through the signer-pinning wrapper; other commands use cli-ext-core.js.
import { readFileSync } from "node:fs";

const argv = process.argv.slice(2);
if (argv[0] !== "verify-offline") {
    await import("./cli-ext-core.js");
}
else {
    const { verifyArtifactOffline } = await import("./extensions/index.js");
    const values = (flag) => argv.flatMap((a, i) => (a === flag && argv[i + 1] ? [argv[i + 1]] : []));
    const one = (flag) => values(flag)[0];
    const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
    const readKey = (path) => {
        const text = readFileSync(path, "utf8").trim();
        if (!text.startsWith("{") && !text.startsWith("["))
            return [text];
        const doc = JSON.parse(text);
        if (Array.isArray(doc))
            return doc;
        if (Array.isArray(doc.keys))
            return doc.keys;
        if (doc.public_key_b64 || doc.public_key_hex)
            return [doc];
        const legacy = doc.publicKey ?? doc.public_key;
        return legacy ? [legacy] : [doc];
    };
    try {
        const input = {};
        if (one("--inclusion"))
            input.inclusion = readJson(one("--inclusion"));
        if (one("--proof"))
            input.proof = readJson(one("--proof"));
        if (one("--sth"))
            input.sth = readJson(one("--sth"));
        if (one("--attestation")) {
            const att = readJson(one("--attestation"));
            if (att?.attestation && att?.payload) {
                input.attestation = att.attestation;
                input.attestationPayload = att.payload;
            }
            else
                input.attestation = att;
        }
        if (one("--attestation-payload"))
            input.attestationPayload = readJson(one("--attestation-payload"));
        if (one("--proof-hex"))
            input.proofHex = readFileSync(one("--proof-hex"), "utf8").trim();
        if (one("--circuit-id"))
            input.circuitId = one("--circuit-id");
        if (argv.includes("--allow-unbound"))
            input.allowUnbound = true;
        if (argv.includes("--accept-legacy-v1"))
            input.rejectLegacyV1 = false;
        if (one("--hmac-secret"))
            input.hmacSecret = one("--hmac-secret");
        const pinned = values("--trusted-key").concat(values("--trusted-keyset")).flatMap(readKey);
        if (one("--pubkey")) {
            const keys = readKey(one("--pubkey"));
            input.publicKey = keys.length === 1 && typeof keys[0] === "string" ? keys[0] : keys;
            if (!pinned.length)
                pinned.push(...keys);
        }
        if (pinned.length)
            input.trustedKeys = pinned;
        if (input.attestation && !input.trustedKeys) {
            console.error("verify-offline: --attestation needs a pinned signer key: --trusted-key key.json (repeatable) or --trusted-keyset keys.json. The key embedded in the attestation is never trusted.");
            process.exit(2);
        }
        const result = verifyArtifactOffline(input);
        console.log(JSON.stringify(result, null, 2));
        process.exit(result.ok ? 0 : 2);
    }
    catch (err) {
        console.error(`verify-offline: ${err instanceof Error ? err.message : err}`);
        process.exit(2);
    }
}
