import { randomUUID } from "node:crypto";
import { AffixApiClient } from "./client.js";
import { resolveConfig } from "./config.js";
import { OfflineQueue } from "./offline-queue.js";
import { ProofStore } from "./proof-store.js";
import { normalizeCredential } from "./credential-normalize.js";
import { redactProveBodyForQueue } from "./queue-body.js";
import { defaultContext, prepareWitness } from "./witness.js";
export class AffixSDK {
    client;
    queue;
    store;
    constructor(config = {}) {
        const resolved = resolveConfig(config);
        this.client = new AffixApiClient(resolved);
        this.queue = new OfflineQueue(resolved.offlineQueuePath);
        this.store = new ProofStore(resolved.proofStorePath);
        this.config = resolved;
    }
    config;
    async isOnline() {
        try {
            const health = await this.client.health();
            return health.status === "ok";
        }
        catch {
            return false;
        }
    }
    async buildWitness(circuitId, credential, context) {
        return prepareWitness(this.client, circuitId, credential, defaultContext(context));
    }
    async prove(input) {
        const body = {
            requestAttestation: input.requestAttestation ?? this.config.requestAttestation,
            sector: input.sector ?? this.config.sector,
        };
        if (input.witness) {
            body.witness = input.witness;
        }
        else if (input.credential) {
            body.credential = normalizeCredential(input.credential);
            body.context = defaultContext(input.context);
        }
        else if (input.fields) {
            body.fields = input.fields;
        }
        else {
            throw new Error("prove_requires_witness_or_credential_or_fields");
        }
        try {
            const data = await this.client.prove(input.circuitId, body);
            const result = this.mapProveResult(input.circuitId, data, input.witness);
            this.store.save({
                proof_id: result.proof_id,
                circuit_id: result.circuit_id,
                proof: result.proof,
                proof_digest: result.proof_digest,
                valid: result.valid,
                created_at: new Date().toISOString(),
                synced: Boolean(result.merkle_root),
                merkle_root: result.merkle_root,
            });
            return result;
        }
        catch (err) {
            if (input.queueOnFailure !== false) {
                this.queue.enqueue({
                    id: randomUUID(),
                    circuit_id: input.circuitId,
                    body: await redactProveBodyForQueue(input.circuitId, {
                        ...body,
                        circuit_id: input.circuitId,
                    }),
                });
            }
            throw err;
        }
    }
    async verify(circuitId, proof, requestAttestation = true) {
        const data = await this.client.verify(circuitId, {
            proof,
            requestAttestation,
            sector: this.config.sector,
        });
        return {
            proof_id: String(data.proof_id ?? ""),
            valid: Boolean(data.valid),
            verified: Boolean(data.verified ?? data.valid),
            decision: data.decision === "yes" ? "yes" : "no",
            circuit_id: circuitId,
            proof_digest: String(data.proof_digest ?? ""),
            merkle_root: typeof data.merkle_root === "string" ? data.merkle_root : undefined,
            merkle_leaf_hash: typeof data.merkle_leaf_hash === "string" ? data.merkle_leaf_hash : undefined,
            attestation: data.attestation,
        };
    }
    async proveAndVerify(input) {
        const prove = await this.prove(input);
        const verify = await this.verify(input.circuitId, prove.proof, input.requestAttestation ?? true);
        return { prove, verify };
    }
    async flushOfflineQueue() {
        const results = [];
        for (const job of this.queue.list()) {
            try {
                const data = await this.client.prove(job.circuit_id, job.body);
                const result = this.mapProveResult(job.circuit_id, data);
                this.store.save({
                    proof_id: result.proof_id,
                    circuit_id: result.circuit_id,
                    proof: result.proof,
                    proof_digest: result.proof_digest,
                    valid: result.valid,
                    created_at: new Date().toISOString(),
                    synced: Boolean(result.merkle_root),
                    merkle_root: result.merkle_root,
                });
                this.queue.remove(job.id);
                results.push(result);
            }
            catch {
                this.queue.bumpAttempt(job.id);
            }
        }
        return results;
    }
    listQueuedJobs() {
        return this.queue.list();
    }
    listStoredProofs() {
        return this.store.list();
    }
    mapProveResult(circuitId, data, witness) {
        return {
            proof_id: String(data.proof_id ?? ""),
            circuit_id: String(data.circuit_id ?? circuitId),
            proof: String(data.proof ?? ""),
            valid: Boolean(data.valid),
            verified: typeof data.verified === "boolean" ? data.verified : Boolean(data.valid),
            decision: data.decision === "yes" ? "yes" : "no",
            proof_digest: String(data.proof_digest ?? ""),
            return_value: typeof data.return_value === "string" ? data.return_value : undefined,
            merkle_root: typeof data.merkle_root === "string" ? data.merkle_root : undefined,
            merkle_leaf_hash: typeof data.merkle_leaf_hash === "string" ? data.merkle_leaf_hash : undefined,
            attestation: data.attestation,
            witness,
        };
    }
}
export { AffixApiClient } from "./client.js";
export { ENV_FILE_PATH, envStatus, loadEnv, maskApiKey } from "./env.js";
export { defaultContext, prepareWitness, randomFieldHex, witnessFromInputs } from "./witness.js";
export * from "./types.js";
