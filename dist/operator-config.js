/* Credit: @paparichens */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createLocalSigningKeyPair } from "./local-signing.js";
import { randomBytes } from "node:crypto";

const DEFAULT_BASE = ".affix";

export function defaultPaths(baseDir = DEFAULT_BASE) {
    return {
        baseDir,
        configPath: join(baseDir, "config.json"),
        secretsDir: join(baseDir, "secrets"),
        hmacSecretPath: join(baseDir, "secrets", "hmac.secret"),
        apiKeyPath: join(baseDir, "secrets", "api.key"),
        signingKeysPath: join(baseDir, "secrets", "mldsa65.json"),
        proofsPath: join(baseDir, "proofs.json"),
        queuePath: join(baseDir, "offline-queue.json"),
        licencePath: join(baseDir, "licence.json"),
        spendDir: join(baseDir, "spend"),
        statsPath: join(baseDir, "stats.json"),
    };
}

export function defaultOperatorConfig() {
    return {
        version: 1,
        proofMode: "hmac",
        licenceOnly: true,
        apiBase: process.env.AFFIX_API_BASE ?? "https://api.affix-io.com",
        presentmentBase: process.env.AFFIX_PRESENTMENT_BASE ?? null,
        storage: {
            proofs: ".affix/proofs.json",
            offlineQueue: ".affix/offline-queue.json",
            licence: ".affix/licence.json",
            spendDir: ".affix/spend",
        },
        connections: {
            internal: null,
            external: null,
        },
        hsm: null,
        brickWithoutLicence: true,
        allowOfflineProve: true,
        autoFlush: false,
        queueUnsyncedProofs: false,
    };
}

function writeSecret(path, value) {
    mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
    writeFileSync(path, value.endsWith("\n") ? value : `${value}\n`, { mode: 0o600 });
    chmodSync(path, 0o600);
}

export function loadOperatorConfig(baseDir = DEFAULT_BASE) {
    const paths = defaultPaths(baseDir);
    // Secrets are provisioned before the first setup run, so they are read
    // whether or not config.json exists yet.
    const exists = existsSync(paths.configPath);
    const fileConfig = exists ? JSON.parse(readFileSync(paths.configPath, "utf8")) : null;
    const config = exists ? { ...defaultOperatorConfig(), ...fileConfig } : defaultOperatorConfig();
    const secrets = {};
    if (existsSync(paths.hmacSecretPath)) {
        secrets.hmacSecret = readFileSync(paths.hmacSecretPath, "utf8").trim();
    }
    if (existsSync(paths.apiKeyPath)) {
        secrets.apiKey = readFileSync(paths.apiKeyPath, "utf8").trim();
    }
    if (existsSync(paths.signingKeysPath)) {
        secrets.signingKeys = JSON.parse(readFileSync(paths.signingKeysPath, "utf8"));
    }
    return { config, paths, secrets, exists, fileConfig };
}

export function loadApiKey(baseDir = DEFAULT_BASE) {
    const paths = defaultPaths(baseDir);
    if (!existsSync(paths.apiKeyPath))
        return null;
    return readFileSync(paths.apiKeyPath, "utf8").trim() || null;
}

export function saveApiKey(baseDir, apiKey) {
    if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length < 8) {
        throw new Error("api_key_must_be_at_least_8_characters");
    }
    const paths = defaultPaths(baseDir);
    mkdirSync(paths.secretsDir, { recursive: true, mode: 0o700 });
    writeSecret(paths.apiKeyPath, apiKey.trim());
    return paths.apiKeyPath;
}

export function apiKeyHint(apiKey) {
    if (!apiKey || apiKey.length <= 10)
        return "***";
    return `${apiKey.slice(0, 6)}…${apiKey.slice(-4)}`;
}

export function saveOperatorConfig(baseDir, config) {
    const paths = defaultPaths(baseDir);
    mkdirSync(baseDir, { recursive: true, mode: 0o700 });
    writeFileSync(paths.configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    chmodSync(paths.configPath, 0o600);
}

export function ensureSecrets(baseDir, options = {}) {
    const paths = defaultPaths(baseDir);
    mkdirSync(paths.secretsDir, { recursive: true, mode: 0o700 });
    let hmacSecret;
    if (existsSync(paths.hmacSecretPath)) {
        hmacSecret = readFileSync(paths.hmacSecretPath, "utf8").trim();
    }
    else {
        hmacSecret = options.hmacSecret ?? randomBytes(32).toString("hex");
        writeSecret(paths.hmacSecretPath, hmacSecret);
    }
    let signingKeys;
    if (existsSync(paths.signingKeysPath)) {
        signingKeys = JSON.parse(readFileSync(paths.signingKeysPath, "utf8"));
    }
    else if (options.generateSigningKey !== false) {
        signingKeys = createLocalSigningKeyPair(options.signingSeedB64);
        writeFileSync(paths.signingKeysPath, `${JSON.stringify(signingKeys, null, 2)}\n`, { mode: 0o600 });
        chmodSync(paths.signingKeysPath, 0o600);
    }
    return { hmacSecret, signingKeys, paths };
}

export function mergeConfigWithEnv(config) {
    return {
        ...config,
        apiBase: process.env.AFFIX_API_BASE ?? config.apiBase,
        presentmentBase: process.env.AFFIX_PRESENTMENT_BASE ?? config.presentmentBase ?? undefined,
        proofMode: process.env.AFFIX_PROOF_MODE ?? config.proofMode,
        licenceOnly: process.env.AFFIX_LICENCE_ONLY === "0" ? false : config.licenceOnly,
    };
}

let ephemeralWarned = false;
function warnEphemeral(what) {
    if (ephemeralWarned)
        return;
    ephemeralWarned = true;
    process.emitWarning?.(`AffixIO: generated an in-memory ${what} for this process only (not written to disk). Proofs and envelopes it signs cannot be checked after a restart. Pass hmacSecret/signingKeys, or persistSecrets: true with an explicit operatorBaseDir.`, { code: "AFFIXIO_EPHEMERAL_SECRETS" });
}

/**
 * 2.0.3 (F1): resolve local secrets without writing anything unless asked.
 *  - Supplied secrets (hmacSecret / signingKeys) are used as-is and never persisted.
 *  - Existing files under baseDir/secrets are read (read-only), so hosts set up by 2.0.2 or
 *    earlier keep their keys.
 *  - Anything still missing is generated. It is written (dir 0700, files 0600) only with
 *    persist: true; otherwise it lives in memory and a one-time warning is emitted.
 */
export function resolveSecrets(baseDir, options = {}) {
    const paths = defaultPaths(baseDir);
    const persist = options.persist === true;
    const existing = options.existing ?? {};
    const ensureDir = () => {
        mkdirSync(paths.secretsDir, { recursive: true, mode: 0o700 });
        chmodSync(paths.secretsDir, 0o700);
    };
    let hmacSecret = options.hmacSecret ?? existing.hmacSecret;
    let hmacSource = options.hmacSecret ? "supplied" : existing.hmacSecret ? "file" : null;
    if (!hmacSecret) {
        hmacSecret = randomBytes(32).toString("hex");
        if (persist) { ensureDir(); writeSecret(paths.hmacSecretPath, hmacSecret); hmacSource = "generated-persisted"; }
        else { hmacSource = "generated-ephemeral"; if (options.warn !== false) warnEphemeral("HMAC secret"); }
    }
    let signingKeys = options.signingKeys ?? existing.signingKeys;
    let signingSource = options.signingKeys ? "supplied" : existing.signingKeys ? "file" : null;
    if (!signingKeys && options.generateSigningKey !== false) {
        signingKeys = createLocalSigningKeyPair(options.signingSeedB64);
        if (persist) {
            ensureDir();
            writeFileSync(paths.signingKeysPath, `${JSON.stringify(signingKeys, null, 2)}\n`, { mode: 0o600 });
            chmodSync(paths.signingKeysPath, 0o600);
            signingSource = "generated-persisted";
        }
        else { signingSource = "generated-ephemeral"; if (options.warn !== false) warnEphemeral("ML-DSA-65 signing key"); }
    }
    return { hmacSecret, signingKeys, paths, sources: { hmacSecret: hmacSource, signingKeys: signingSource } };
}
