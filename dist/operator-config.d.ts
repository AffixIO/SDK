import type { HsmProfile, HttpDataProfile } from "./types.js";
import type { LocalSigningKeyPair } from "./local-signing.js";

export type OperatorPaths = {
    baseDir: string;
    configPath: string;
    secretsDir: string;
    hmacSecretPath: string;
    apiKeyPath: string;
    signingKeysPath: string;
    proofsPath: string;
    queuePath: string;
    licencePath: string;
    spendDir: string;
    statsPath: string;
};

export type OperatorConfig = {
    version: number;
    proofMode: "hmac" | "ultrahonk";
    licenceOnly: boolean;
    apiBase: string;
    presentmentBase: string | null;
    storage: {
        proofs: string;
        offlineQueue: string;
        licence: string;
        spendDir: string;
    };
    connections: {
        internal: HttpDataProfile | null;
        external: HttpDataProfile | null;
    };
    hsm: HsmProfile | null;
    brickWithoutLicence: boolean;
    allowOfflineProve: boolean;
    autoFlush: boolean;
    queueUnsyncedProofs: boolean;
};

export declare function defaultPaths(baseDir?: string): OperatorPaths;
export declare function defaultOperatorConfig(): OperatorConfig;
export declare function loadOperatorConfig(baseDir?: string): {
    config: OperatorConfig;
    paths: OperatorPaths;
    secrets: {
        hmacSecret?: string;
        apiKey?: string;
        signingKeys?: LocalSigningKeyPair;
    };
};
export declare function saveOperatorConfig(baseDir: string, config: OperatorConfig): void;
export declare function loadApiKey(baseDir?: string): string | null;
export declare function saveApiKey(baseDir: string, apiKey: string): string;
export declare function apiKeyHint(apiKey: string | undefined | null): string;
export declare function ensureSecrets(baseDir: string, options?: {
    hmacSecret?: string;
    signingSeedB64?: string;
}): {
    hmacSecret: string;
    signingKeys: LocalSigningKeyPair;
    paths: OperatorPaths;
};
export declare function mergeConfigWithEnv(config: OperatorConfig): OperatorConfig;
