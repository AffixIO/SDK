import { loadEnv } from "./env.js";
export function resolveConfig(partial) {
    loadEnv();
    const apiKey = partial.apiKey ?? process.env.AFFIX_API_KEY?.trim();
    if (!apiKey) {
        throw new Error("api_key_required: set AFFIX_API_KEY in .env or pass apiKey to AffixSDK");
    }
    return {
        apiBase: partial.apiBase ?? process.env.AFFIX_API_BASE ?? "https://api.affix-io.com",
        apiKey,
        requestAttestation: partial.requestAttestation ?? true,
        sector: partial.sector,
        offlineQueuePath: partial.offlineQueuePath ?? ".affix/offline-queue.json",
        proofStorePath: partial.proofStorePath ?? ".affix/proofs.json",
        timeoutMs: partial.timeoutMs ?? 120_000,
    };
}
