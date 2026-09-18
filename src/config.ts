/* Credit: @paparichens */
import { DEFAULT_AFFIX_API_BASE, normaliseApiBase, normalisePresentmentBase } from "./constants.js";
import { createDefaultJsonDocumentStore, STORAGE_KEYS, type AffixDocumentStore } from "./storage/index.js";
import type { AffixSdkConfig } from "./types.js";
const DAY = 24 * 60 * 60 * 1000;
export { DEFAULT_AFFIX_API_BASE, normaliseApiBase, normalisePresentmentBase, } from "./constants.js";

export type ResolvedStorageDrivers = {
    proofs: AffixDocumentStore;
    queue: AffixDocumentStore;
    codeUses: AffixDocumentStore;
    licence: AffixDocumentStore;
    stats: AffixDocumentStore;
};
export function resolveStorageDrivers(config: AffixSdkConfig): ResolvedStorageDrivers {
    const storage = config.storage ?? {};
    const shared = storage.documentStore ?? config.documentStore;
    const jsonFallback = createDefaultJsonDocumentStore({
        proofs: config.proofStorePath ?? ".affix/proofs.json",
        offlineQueue: config.offlineQueuePath ?? ".affix/offline-queue.json",
        codeUses: config.codeUsesPath ?? ".affix/code-uses.json",
        licence: config.licenceStatePath ?? ".affix/licence.json",
        stats: config.statsPath ?? ".affix/stats.json",
    });
    return {
        proofs: storage.proofs ?? shared ?? jsonFallback,
        queue: storage.queue ?? shared ?? jsonFallback,
        codeUses: storage.codeUses ?? shared ?? jsonFallback,
        licence: storage.licence ?? shared ?? jsonFallback,
        stats: storage.stats ?? shared ?? jsonFallback,
    };
}
export function resolveConfig(partial: Partial<AffixSdkConfig> & {
    apiKey: string;
}): AffixSdkConfig {
    const licenceOnly = partial.licenceOnly ?? (process.env.AFFIX_LICENCE_ONLY === "0" ? false : partial.licenceOnly ?? true);
    return {
        apiBase: normaliseApiBase(partial.apiBase ?? process.env.AFFIX_API_BASE ?? DEFAULT_AFFIX_API_BASE),
        apiKey: partial.apiKey,
        requestAttestation: partial.requestAttestation ?? true,
        sector: partial.sector ?? "enterprise",
        proofMode: (partial.proofMode ?? process.env.AFFIX_PROOF_MODE ?? "hmac") as AffixSdkConfig["proofMode"],
        licenceOnly,
        proofStorePath: partial.proofStorePath ?? ".affix/proofs.json",
        licenceStatePath: partial.licenceStatePath ?? ".affix/licence.json",
        offlineQueuePath: partial.offlineQueuePath ?? ".affix/offline-queue.json",
        spendDir: partial.spendDir ?? ".affix/spend",
        statsPath: partial.statsPath ?? ".affix/stats.json",
        hmacSecret: partial.hmacSecret ?? process.env.AFFIX_LOCAL_HMAC_SECRET,
        signingKeys: partial.signingKeys,
        signingKeysPath: partial.signingKeysPath ?? ".affix/secrets/mldsa65.json",
        hmacSecretPath: partial.hmacSecretPath ?? ".affix/secrets/hmac.secret",
        operatorBaseDir: partial.operatorBaseDir ?? ".affix",
        connections: partial.connections ?? { internal: null, external: null },
        hsm: partial.hsm ?? null,
        storage: partial.storage,
        documentStore: partial.documentStore,
        timeoutMs: partial.timeoutMs ?? 120_000,
        licenceMinIntervalMs: partial.licenceMinIntervalMs ?? Math.floor(1.5 * DAY),
        licenceMaxIntervalMs: partial.licenceMaxIntervalMs ?? Math.floor(2.5 * DAY),
        brickWithoutLicence: partial.brickWithoutLicence ?? true,
        allowOfflineProve: partial.allowOfflineProve ?? true,
        quotaPulseMinMs: partial.quotaPulseMinMs ?? 15_000,
        enforceProofQuota: partial.enforceProofQuota ?? true,
        queueUnsyncedProofs: partial.queueUnsyncedProofs ?? (licenceOnly ? false : true),
        maxMerkleLeaves: partial.maxMerkleLeaves ?? 50_000,
        flushChunkSize: Math.min(25, Math.max(1, partial.flushChunkSize ?? 25)),
        flushConcurrency: Math.min(16, Math.max(1, partial.flushConcurrency ?? 4)),
        merkleAuditBatchSize: Math.min(1000, Math.max(1, partial.merkleAuditBatchSize ?? 1000)),
        autoFlush: partial.autoFlush ?? (licenceOnly ? false : true),
        autoFlushIntervalMs: Math.max(1000, partial.autoFlushIntervalMs ?? 5_000),
        codeUsesPath: partial.codeUsesPath ?? ".affix/code-uses.json",
        /** Optional customer URL base for QR/barcode presentment links. No AffixIO default. */
        presentmentBase: normalisePresentmentBase(partial.presentmentBase ?? process.env.AFFIX_PRESENTMENT_BASE),
    };
}
export { STORAGE_KEYS };
