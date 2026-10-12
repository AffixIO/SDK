import type { AffixSdkConfig } from "./types.js";
export declare class AffixApiClient {
    private readonly config;
    constructor(config: AffixSdkConfig);
    private headers;
    get(path: string): Promise<Record<string, unknown>>;
    post(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>>;
    health(): Promise<Record<string, unknown>>;
    listCircuits(): Promise<Record<string, unknown>>;
    verify(circuitId: string, body: Record<string, unknown>): Promise<Record<string, unknown>>;
    merkleRoot(): Promise<Record<string, unknown>>;
    merkleAudit(body: Record<string, unknown>): Promise<Record<string, unknown>>;
    merkleVerifyProof(body: Record<string, unknown>): Promise<Record<string, unknown>>;
    /** Affix bulk verify: 1..25 proofs per call (no ML-DSA; prefer circuit verify for signing). */
    aggregateVerify(items: Array<{
        circuit_id: string;
        proof: string;
    }>): Promise<Record<string, unknown>>;
    /** Affix ML-DSA-65 sign over a JSON payload (`POST /api/attest`). */
    attest(payload: Record<string, unknown>): Promise<Record<string, unknown>>;
    /**
     * Bulk Merkle leaf audit (Affix audit tree, max ~1000 digests per call).
     * Loop client-side to cover up to AFFIX_MERKLE_MAX_LEAVES (50_000).
     */
    merkleAuditBatch(body: {
        items: Array<{
            digest: string;
            circuit_id?: string;
            proof_id?: string | null;
            event?: string;
        }>;
        include_inclusions?: boolean;
    }): Promise<Record<string, unknown>>;
}
