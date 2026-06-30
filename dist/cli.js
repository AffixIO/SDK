#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { AffixSDK, defaultContext, envStatus, loadEnv, randomFieldHex } from "./index.js";
loadEnv();
function arg(name) {
    const idx = process.argv.indexOf(name);
    if (idx === -1)
        return undefined;
    return process.argv[idx + 1];
}
function resolveVerifyTarget(sdk, target, circuitFlag) {
    const stored = sdk.listStoredProofs().find((p) => p.proof_id === target);
    if (stored) {
        return { circuitId: stored.circuit_id, proof: stored.proof };
    }
    if (existsSync(target)) {
        const raw = readFileSync(target, "utf8").trim();
        try {
            const parsed = JSON.parse(raw);
            if (parsed.proof && parsed.circuit_id) {
                return { circuitId: parsed.circuit_id, proof: parsed.proof };
            }
            if (parsed.proof && circuitFlag) {
                return { circuitId: circuitFlag, proof: parsed.proof };
            }
        }
        catch {
            if (circuitFlag) {
                return { circuitId: circuitFlag, proof: raw };
            }
        }
        throw new Error("verify_path_needs_circuit_or_json_with_circuit_id");
    }
    if (circuitFlag) {
        return { circuitId: circuitFlag, proof: target };
    }
    throw new Error("verify_needs_stored_proof_id_path_or_circuit");
}
async function main() {
    const command = process.argv[2] ?? "health";
    if (command === "config") {
        console.log(JSON.stringify(envStatus(), null, 2));
        return;
    }
    const apiKey = process.env.AFFIX_API_KEY ?? arg("--api-key");
    if (!apiKey) {
        const status = envStatus();
        console.error(`Set AFFIX_API_KEY in ${status.env_file} or pass --api-key`);
        process.exit(1);
    }
    const sdk = new AffixSDK({
        apiKey,
        apiBase: process.env.AFFIX_API_BASE ?? arg("--api-base") ?? "https://api.affix-io.com",
    });
    if (command === "health") {
        console.log(JSON.stringify(await sdk.client.health(), null, 2));
        return;
    }
    if (command === "flush") {
        const flushed = await sdk.flushOfflineQueue();
        console.log(JSON.stringify({ flushed: flushed.length, proofs: flushed }, null, 2));
        return;
    }
    if (command === "circuits") {
        console.log(JSON.stringify(await sdk.client.listCircuits(), null, 2));
        return;
    }
    if (command === "list") {
        console.log(JSON.stringify({
            queued: sdk.listQueuedJobs(),
            stored: sdk.listStoredProofs(),
        }, null, 2));
        return;
    }
    if (command === "verify") {
        const target = process.argv[3];
        if (!target) {
            console.error("Usage: affix-sdk verify <proof-id-or-path> [--circuit <id>]");
            process.exit(1);
        }
        const circuitFlag = arg("--circuit");
        const { circuitId, proof } = resolveVerifyTarget(sdk, target, circuitFlag);
        const result = await sdk.verify(circuitId, proof);
        console.log(JSON.stringify(result, null, 2));
        return;
    }
    if (command === "prove") {
        const circuitId = arg("--circuit") ?? "ticket_local_resident";
        const now = Math.floor(Date.now() / 1000);
        const claim = arg("--claim") ?? "local_resident";
        const region = arg("--region") ?? claim;
        const schemaLabel = arg("--schema") ?? "residency_v1";
        const credential = {
            schema_id: schemaLabel,
            issuer_id: "demo_issuer",
            issuer_pubkey_hash: randomFieldHex(),
            credential_id: randomFieldHex(),
            claim_value: claim,
            valid_from: now - 86_400,
            valid_until: now + 31_536_000,
            fields: { region },
        };
        const context = defaultContext({
            region_hash: region,
            as_of_timestamp: now,
        });
        const result = await sdk.prove({ circuitId, credential, context });
        console.log(JSON.stringify(result, null, 2));
        return;
    }
    console.log("Usage: affix-sdk config | health | prove | verify | circuits | list | flush");
}
main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
});
