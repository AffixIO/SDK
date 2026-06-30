import type { SdkConfig } from "./types.js";
export type ApiResponse<T> = {
    ok: boolean;
    status: number;
    data: T;
};
export declare class AffixApiClient {
    private readonly config;
    constructor(config: SdkConfig);
    private headers;
    health(): Promise<Record<string, unknown>>;
    listCircuits(): Promise<Record<string, unknown>>;
    prepareWitness(body: Record<string, unknown>): Promise<Record<string, unknown>>;
    prove(circuitId: string, body: Record<string, unknown>): Promise<Record<string, unknown>>;
    verify(circuitId: string, body: Record<string, unknown>): Promise<Record<string, unknown>>;
    merkleAudit(body: Record<string, unknown>): Promise<Record<string, unknown>>;
    merkleRoot(): Promise<Record<string, unknown>>;
    private get;
    private post;
    private parse;
}
