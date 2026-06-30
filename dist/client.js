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
            "User-Agent": "AffixIO-SDK-Web/2.0",
        };
    }
    async health() {
        return this.get("/api/health");
    }
    async listCircuits() {
        return this.get("/v1/circuits");
    }
    async prepareWitness(body) {
        return this.post("/v1/witness/prepare", body);
    }
    async prove(circuitId, body) {
        return this.post(`/v1/circuits/${encodeURIComponent(circuitId)}/prove`, body);
    }
    async verify(circuitId, body) {
        return this.post(`/v1/circuits/${encodeURIComponent(circuitId)}/verify`, body);
    }
    async merkleAudit(body) {
        return this.post("/v1/merkle/audit", body);
    }
    async merkleRoot() {
        return this.get("/v1/merkle/root");
    }
    async get(path) {
        const res = await requestJson(`${this.config.apiBase}${path}`, {
            method: "GET",
            headers: this.headers(),
            timeoutMs: this.config.timeoutMs ?? 120_000,
        });
        return this.parse(res);
    }
    async post(path, body) {
        const res = await requestJson(`${this.config.apiBase}${path}`, {
            method: "POST",
            headers: this.headers(),
            body: JSON.stringify(body),
            timeoutMs: this.config.timeoutMs ?? 120_000,
        });
        return this.parse(res);
    }
    async parse(res) {
        let data = {};
        try {
            data = (await res.json());
        }
        catch {
            data = { error: "invalid_json" };
        }
        if (!res.ok) {
            const message = typeof data.message === "string"
                ? data.message
                : typeof data.error === "string"
                    ? data.error
                    : `http_${res.status}`;
            throw new Error(message);
        }
        return data;
    }
}
