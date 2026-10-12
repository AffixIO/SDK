import { requestJson } from "./http.js";
export class AffixApiClient {
    config;
    constructor(config) {
        this.config = config;
    }
    headers() {
        return {
            Accept: "application/json",
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.config.apiKey}`,
            "X-API-Key": this.config.apiKey,
            "User-Agent": "AffixIO-SDK/2.0.0",
        };
    }
    async get(path) {
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
    async post(path, body) {
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
    health() {
        return this.get("/api/health");
    }
    listCircuits() {
        return this.get("/v1/circuits");
    }
    verify(circuitId, body) {
        return this.post(`/v1/circuits/${encodeURIComponent(circuitId)}/verify`, body);
    }
    merkleRoot() {
        return this.get("/v1/merkle/root");
    }
    merkleAudit(body) {
        return this.post("/v1/merkle/audit", body);
    }
    merkleVerifyProof(body) {
        return this.post("/v1/merkle/verify-proof", body);
    }
    /** Affix bulk verify: 1..25 proofs per call (no ML-DSA; prefer circuit verify for signing). */
    aggregateVerify(items) {
        return this.post("/v1/aggregate/verify", { items });
    }
    /** Affix ML-DSA-65 sign over a JSON payload (`POST /api/attest`). */
    attest(payload) {
        return this.post("/api/attest", { payload });
    }
    /**
     * Bulk Merkle leaf audit (Affix audit tree, max ~1000 digests per call).
     * Loop client-side to cover up to AFFIX_MERKLE_MAX_LEAVES (50_000).
     */
    merkleAuditBatch(body) {
        return this.post("/v1/merkle/audit/batch", body);
    }
}
