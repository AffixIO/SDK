import { createMemoryDocumentStore } from "./storage/memory-store.js";
import { DEFAULT_AFFIX_API_BASE, normaliseApiBase, normalisePresentmentBase } from "./constants.js";
import { createDefaultJsonDocumentStore, STORAGE_KEYS, } from "./storage/index.js";
const DAY = 24 * 60 * 60 * 1000;
export { DEFAULT_AFFIX_API_BASE, normaliseApiBase, normalisePresentmentBase, } from "./constants.js";
export function resolveStorageDrivers(config) {
    const storage = config.storage ?? {};
    const shared = storage.documentStore ?? config.documentStore;
    // 2.0.3 (H3): with no operatorBaseDir (and no persistSecrets/persistData), data is kept in
    // memory unless a path for that file was given explicitly. Nothing lands in the CWD.
    if (config.ephemeralData) {
        const mem = createMemoryDocumentStore();
        mem.affixInternalMemory = true; // ProofStore keeps parsed records instead of a JSON string
        const ex = config.explicitPaths ?? {};
        const files = {};
        for (const [k, p] of [["proofs", ex.proofs], ["offlineQueue", ex.offlineQueue], ["codeUses", ex.codeUses], ["licence", ex.licence], ["stats", ex.stats]])
            if (p) files[k] = p;
        const fileStore = Object.keys(files).length ? createDefaultJsonDocumentStore(files) : null;
        const pick = (k) => (files[k] ? fileStore : mem);
        return {
            proofs: storage.proofs ?? shared ?? pick("proofs"),
            queue: storage.queue ?? shared ?? pick("offlineQueue"),
            codeUses: storage.codeUses ?? shared ?? pick("codeUses"),
            licence: storage.licence ?? shared ?? pick("licence"),
            stats: storage.stats ?? shared ?? pick("stats"),
        };
    }
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
/**
 * 2.0.3 (F2): resolve the API base from explicit sources only, and never fall back silently.
 * Precedence: config.apiBase, then AFFIX_API_BASE, then (in the SDK) the operator config.json,
 * then the default https://api.affix-io.com. When config.apiBase and AFFIX_API_BASE are both
 * set and differ, this throws affixio_api_base_conflict.
 */
export function resolveApiBase(explicit, env = process.env.AFFIX_API_BASE) {
    const e = typeof explicit === "string" && explicit.trim() ? normaliseApiBase(explicit) : null;
    const v = typeof env === "string" && env.trim() ? normaliseApiBase(env) : null;
    if (e && v && e !== v)
        throw new Error(`affixio_api_base_conflict: config.apiBase (${e}) and AFFIX_API_BASE (${v}) differ. Set one, or make them equal.`);
    return { apiBase: e ?? v ?? DEFAULT_AFFIX_API_BASE, source: e ? "config" : v ? "env" : "default" };
}
export function resolveConfig(partial) {
    const base = resolveApiBase(partial.apiBase);
    const dir = partial.operatorBaseDir ?? ".affix";
    const ephemeralData = partial.operatorBaseDir === undefined && partial.persistSecrets !== true && partial.persistData !== true;
    const licenceOnly = partial.licenceOnly ?? (process.env.AFFIX_LICENCE_ONLY === "0" ? false : partial.licenceOnly ?? true);
    return {
        apiBase: base.apiBase,
        apiBaseSource: base.source,
        apiKey: partial.apiKey,
        requestAttestation: partial.requestAttestation ?? true,
        sector: partial.sector ?? "enterprise",
        proofMode: partial.proofMode ?? process.env.AFFIX_PROOF_MODE ?? "hmac",
        licenceOnly,
        proofStorePath: partial.proofStorePath ?? `${dir}/proofs.json`,
        licenceStatePath: partial.licenceStatePath ?? `${dir}/licence.json`,
        offlineQueuePath: partial.offlineQueuePath ?? `${dir}/offline-queue.json`,
        spendDir: partial.spendDir ?? `${dir}/spend`,
        statsPath: partial.statsPath ?? `${dir}/stats.json`,
        hmacSecret: partial.hmacSecret ?? process.env.AFFIX_LOCAL_HMAC_SECRET,
        signingKeys: partial.signingKeys,
        signingKeysPath: partial.signingKeysPath ?? `${dir}/secrets/mldsa65.json`,
        hmacSecretPath: partial.hmacSecretPath ?? `${dir}/secrets/hmac.secret`,
        operatorBaseDir: dir,
        ephemeralData,
        explicitPaths: { proofs: partial.proofStorePath, offlineQueue: partial.offlineQueuePath, codeUses: partial.codeUsesPath, licence: partial.licenceStatePath, stats: partial.statsPath, spend: partial.spendDir },
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
        codeUsesPath: partial.codeUsesPath ?? `${dir}/code-uses.json`,
        /** Optional customer URL base for QR/barcode presentment links. No AffixIO default. */
        presentmentBase: normalisePresentmentBase(partial.presentmentBase ?? process.env.AFFIX_PRESENTMENT_BASE),
    };
}
export { STORAGE_KEYS };
