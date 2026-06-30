import { AffixApiClient } from "./client.js";
import type { AffixCredential, ProveResult, SdkConfig, VerifyResult, WitnessContext, WitnessPackage } from "./types.js";
export type ProveInput = {
    circuitId: string;
    credential?: AffixCredential;
    context?: WitnessContext;
    witness?: WitnessPackage;
    fields?: Record<string, string | number | boolean>;
    sector?: string;
    requestAttestation?: boolean;
    queueOnFailure?: boolean;
};
export declare class AffixSDK {
    readonly client: AffixApiClient;
    private readonly queue;
    private readonly store;
    constructor(config?: Partial<SdkConfig> & {
        apiKey?: string;
    });
    private readonly config;
    isOnline(): Promise<boolean>;
    buildWitness(circuitId: string, credential: AffixCredential, context?: Partial<WitnessContext>): Promise<WitnessPackage>;
    prove(input: ProveInput): Promise<ProveResult>;
    verify(circuitId: string, proof: string, requestAttestation?: boolean): Promise<VerifyResult>;
    proveAndVerify(input: ProveInput): Promise<{
        prove: ProveResult;
        verify: VerifyResult;
    }>;
    flushOfflineQueue(): Promise<ProveResult[]>;
    listQueuedJobs(): import("./types.js").QueuedProveJob[];
    listStoredProofs(): import("./types.js").StoredProof[];
    private mapProveResult;
}
export { AffixApiClient } from "./client.js";
export { ENV_FILE_PATH, envStatus, loadEnv, maskApiKey } from "./env.js";
export type { EnvStatus } from "./env.js";
export { defaultContext, prepareWitness, randomFieldHex, witnessFromInputs } from "./witness.js";
export * from "./types.js";
