/** Matches affix-api merkle.ts (sha256-sorted-pairs). */
export type MerkleProofStep = {
    sibling: string;
    side: "left" | "right";
};
/** Enterprise batch default (aligns with Affix AFFIX_MERKLE_MAX_LEAVES default). */
export declare const MAX_MERKLE_LEAVES = 50000;
export declare function leafHashFromPayload(payload: unknown): string;
export declare function leafHashFromDigest(digest: string): string;
export declare function buildMerkleTree(leafHashes: string[]): {
    root: string;
    layers: string[][];
};
export declare function merkleProofForIndex(layers: string[][], index: number): MerkleProofStep[];
export declare function verifyMerkleProof(leaf: string, root: string, proof: MerkleProofStep[]): boolean;
export declare function emptyMerkleRoot(): string;
export type BatchLeaf = {
    proof_id: string;
    circuit_id: string;
    proof_digest: string;
    /** Omitted when includeProofBytes is false (recommended at 50k leaves). */
    proof?: string;
    leaf_hash: string;
    index: number;
    inclusion: MerkleProofStep[];
};
export type MerkleBatch = {
    batch_id: string;
    created_at: string;
    root: string;
    leaf_count: number;
    max_leaves: number;
    algorithm: "sha256-sorted-pairs";
    leaves: BatchLeaf[];
};
/**
 * Build a client-side Merkle batch over local proof digests for bulk hand-off to AffixIO.
 * Caps at maxLeaves (default 50_000). Affix API validates leaves via /v1/merkle/audit/batch.
 *
 * At 50_000 leaves omit proof bytes (includeProofBytes: false) to stay within memory limits.
 */
export declare function buildProofMerkleBatch(items: Array<{
    proof_id: string;
    circuit_id: string;
    proof_digest: string;
    proof?: string;
}>, options?: {
    maxLeaves?: number;
    batchId?: string;
    includeProofBytes?: boolean;
}): MerkleBatch;
/**
 * Verify all (or sampled) inclusion paths for a client batch.
 * For 50k leaves, sampleIndices avoids O(n log n) cost when full check is not required.
 */
export declare function verifyBatchInclusions(batch: MerkleBatch, options?: {
    sampleIndices?: number[];
}): boolean;
/** Build digests-only leaf list for Affix bulk audit (max 1000 per HTTP call on server). */
export declare function merkleAuditItemsFromBatch(batch: MerkleBatch): Array<{
    digest: string;
    circuit_id: string;
    proof_id: string;
    event: "verified";
}>;
/**
 * Normalise Affix merkle audit / batch leaf fields.
 * Single audit returns `merkle_leaf_hash`; batch returns `leaf_hash`.
 */
export declare function normalizeMerkleAuditLeaf(leaf: Record<string, unknown> | null | undefined, fallbackRoot?: string): {
    merkle_root?: string;
    merkle_leaf_hash?: string;
};
