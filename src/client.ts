/* Credit: @paparichens */
import { requestJson } from "./http.js";
import type { AffixSdkConfig } from "./types.js";
export class AffixApiClient {
    config;
    constructor(config: AffixSdkConfig) {
        this.config = config;
    }
    headers() {
        return {
            Accept: "application/json",
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.config.apiKey}`,
            "X-API-Key": this.config.apiKey,
            "User-Agent": "AffixIO-SDK/1.0",
        };
    }
    async get(path: string): Promise<Record<string, unknown>> {
        const res = await requestJson(`${this.config.apiBase}${path}`, {
            method: "GET",
            headers: this.headers(),
            timeoutMs: this.config.timeoutMs,
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(String(data.error ?? data.message ?? `http_${res.status}`));
        }
        return data;
    }
    async post(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
        const res = await requestJson(`${this.config.apiBase}${path}`, {
            method: "POST",
            headers: this.headers(),
            body: JSON.stringify(body),
            timeoutMs: this.config.timeoutMs,
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(String(data.error ?? data.message ?? `http_${res.status}`));
        }
        return data;
    }
    authCheck() {
        return this.get("/v1/auth/check");
    }
    authPulse() {
        return this.get("/v1/auth/pulse");
    }
    consumeProofQuota(count = 1) {
        return this.post("/v1/quota/consume", { count });
    }
    health(): Promise<Record<string, unknown>> {
        return this.get("/api/health");
    }
    listCircuits(): Promise<Record<string, unknown>> {
        return this.get("/v1/circuits");
    }
    verify(circuitId: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
        return this.post(`/v1/circuits/${encodeURIComponent(circuitId)}/verify`, body);
    }
    merkleRoot(): Promise<Record<string, unknown>> {
        return this.get("/v1/merkle/root");
    }
    merkleAudit(body: Record<string, unknown>): Promise<Record<string, unknown>> {
        return this.post("/v1/merkle/audit", body);
    }
    merkleVerifyProof(body: Record<string, unknown>): Promise<Record<string, unknown>> {
        return this.post("/v1/merkle/verify-proof", body);
    }
    /** Affix bulk verify: 1..25 proofs per call (no ML-DSA; prefer circuit verify for signing). */
    aggregateVerify(items: Array<{
        circuit_id: string;
        proof: string;
    }>): Promise<Record<string, unknown>> {
        return this.post("/v1/aggregate/verify", { items });
    }
    /** Affix ML-DSA-65 sign over a JSON payload (`POST /api/attest`). */
    attest(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
        return this.post("/api/attest", { payload });
    }
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
    }): Promise<Record<string, unknown>> {
        return this.post("/v1/merkle/audit/batch", body);
    }
}
