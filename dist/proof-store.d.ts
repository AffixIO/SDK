import { type AffixDocumentStore } from "./storage/index.js";
export type StoredProof = {
    proof_id: string;
    circuit_id: string;
    proof: string;
    proof_digest: string;
    valid: boolean;
    created_at: string;
    offline?: boolean;
    synced?: boolean;
    decision?: "yes" | "no";
    /** Affix Merkle root after successful flush / verify. */
    merkle_root?: string;
    /** Affix Merkle leaf hash after successful flush / verify. */
    merkle_leaf_hash?: string;
    /** Affix ML-DSA-65 attestation (signed). */
    attestation?: {
        algorithm?: string;
        mldsa_signature_b64?: string;
        public_key_b64?: string;
        signed_at?: string;
        [key: string]: unknown;
    };
    /** ISO time when Affix attestation was recorded locally. */
    attested_at?: string;
    /** Correlates one host request → one proof (data-check or manual). */
    request_id?: string;
    /** e.g. data_check | manual */
    origin?: string;
    record_id?: string;
    /** Non-PII meta (source adapter, dialect, …). */
    meta?: Record<string, string>;
};
export declare class ProofStore {
    docs: any;
    max: any;
    key: any;
    constructor(docs: AffixDocumentStore, max?: number, key?: string);
    read(): Promise<any[]>;
    write(items: any): Promise<void>;
    save(proof: StoredProof): Promise<void>;
    list(): Promise<StoredProof[]>;
}
