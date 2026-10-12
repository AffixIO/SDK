import { createHash } from "node:crypto";
const LEAF_PREFIX = "affix:leaf:";
const NODE_PREFIX = "affix:node:";
const EMPTY_ROOT = createHash("sha256").update("affix:empty:").digest("hex");
/** Enterprise batch default (aligns with Affix AFFIX_MERKLE_MAX_LEAVES default). */
export const MAX_MERKLE_LEAVES = 50_000;
function hashLeaf(data) {
    return createHash("sha256").update(LEAF_PREFIX).update(data).digest("hex");
}
function hashNode(left, right) {
    const [a, b] = left < right ? [left, right] : [right, left];
    return createHash("sha256").update(NODE_PREFIX).update(a).update(b).digest("hex");
}
export function leafHashFromPayload(payload) {
    return hashLeaf(JSON.stringify(payload));
}
export function leafHashFromDigest(digest) {
    const d = digest.replace(/^0x/, "").toLowerCase();
    return hashLeaf(d);
}
export function buildMerkleTree(leafHashes) {
    if (leafHashes.length === 0) {
        return { root: EMPTY_ROOT, layers: [[]] };
    }
    const layers = [leafHashes.slice()];
    while (layers[layers.length - 1].length > 1) {
        const prev = layers[layers.length - 1];
        const next = [];
        for (let i = 0; i < prev.length; i += 2) {
            if (i + 1 < prev.length) {
                next.push(hashNode(prev[i], prev[i + 1]));
            }
            else {
                next.push(hashNode(prev[i], prev[i]));
            }
        }
        layers.push(next);
    }
    return { root: layers[layers.length - 1][0], layers };
}
export function merkleProofForIndex(layers, index) {
    const proof = [];
    if (layers.length === 0 || layers[0].length === 0) {
        return proof;
    }
    let idx = index;
    for (let level = 0; level < layers.length - 1; level++) {
        const row = layers[level];
        const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
        if (siblingIdx < row.length) {
            proof.push({
                sibling: row[siblingIdx],
                side: idx % 2 === 0 ? "right" : "left",
            });
        }
        else {
            proof.push({
                sibling: row[idx],
                side: "right",
            });
        }
        idx = Math.floor(idx / 2);
    }
    return proof;
}
export function verifyMerkleProof(leaf, root, proof) {
    if (leaf === root && proof.length === 0) {
        return true;
    }
    let current = leaf;
    for (const step of proof) {
        if (step.side === "left") {
            current = hashNode(step.sibling, current);
        }
        else {
            current = hashNode(current, step.sibling);
        }
    }
    return current === root;
}
export function emptyMerkleRoot() {
    return EMPTY_ROOT;
}
/**
 * Build a client-side Merkle batch over local proof digests for bulk hand-off to AffixIO.
 * Caps at maxLeaves (default 50_000). Affix API validates leaves via /v1/merkle/audit/batch.
 *
 * At 50_000 leaves omit proof bytes (includeProofBytes: false) to stay within memory limits.
 */
export function buildProofMerkleBatch(items, options) {
    const maxLeaves = options?.maxLeaves ?? MAX_MERKLE_LEAVES;
    const includeProofBytes = options?.includeProofBytes ?? items.length <= 1_000;
    if (items.length === 0) {
        throw new Error("merkle_batch_empty");
    }
    if (items.length > maxLeaves) {
        throw new Error(`merkle_batch_too_large:${items.length}>${maxLeaves}`);
    }
    const leafHashes = items.map((item) => leafHashFromDigest(item.proof_digest));
    const { root, layers } = buildMerkleTree(leafHashes);
    const leaves = items.map((item, index) => {
        const row = {
            proof_id: item.proof_id,
            circuit_id: item.circuit_id,
            proof_digest: item.proof_digest.replace(/^0x/, "").toLowerCase(),
            leaf_hash: leafHashes[index],
            index,
            inclusion: merkleProofForIndex(layers, index),
        };
        if (includeProofBytes && item.proof !== undefined) {
            row.proof = item.proof;
        }
        return row;
    });
    return {
        batch_id: options?.batchId ?? `batch_${createHash("sha256").update(root).digest("hex").slice(0, 16)}`,
        created_at: new Date().toISOString(),
        root,
        leaf_count: leaves.length,
        max_leaves: maxLeaves,
        algorithm: "sha256-sorted-pairs",
        leaves,
    };
}
/**
 * Verify all (or sampled) inclusion paths for a client batch.
 * For 50k leaves, sampleIndices avoids O(n log n) cost when full check is not required.
 */
export function verifyBatchInclusions(batch, options) {
    if (options?.sampleIndices?.length) {
        for (const index of options.sampleIndices) {
            const leaf = batch.leaves[index];
            if (!leaf || !verifyMerkleProof(leaf.leaf_hash, batch.root, leaf.inclusion)) {
                return false;
            }
        }
        return true;
    }
    for (const leaf of batch.leaves) {
        if (!verifyMerkleProof(leaf.leaf_hash, batch.root, leaf.inclusion)) {
            return false;
        }
    }
    return true;
}
/** Build digests-only leaf list for Affix bulk audit (max 1000 per HTTP call on server). */
export function merkleAuditItemsFromBatch(batch) {
    return batch.leaves.map((leaf) => ({
        digest: leaf.proof_digest,
        circuit_id: leaf.circuit_id,
        proof_id: leaf.proof_id,
        event: "verified",
    }));
}
/**
 * Normalise Affix merkle audit / batch leaf fields.
 * Single audit returns `merkle_leaf_hash`; batch returns `leaf_hash`.
 */
export function normalizeMerkleAuditLeaf(leaf, fallbackRoot) {
    if (!leaf || typeof leaf !== "object") {
        return {
            merkle_root: typeof fallbackRoot === "string" && fallbackRoot ? fallbackRoot : undefined,
        };
    }
    const merkle_root = typeof leaf.merkle_root === "string" && leaf.merkle_root
        ? leaf.merkle_root
        : typeof leaf.root === "string" && leaf.root
            ? leaf.root
            : typeof fallbackRoot === "string" && fallbackRoot
                ? fallbackRoot
                : undefined;
    const merkle_leaf_hash = typeof leaf.merkle_leaf_hash === "string" && leaf.merkle_leaf_hash
        ? leaf.merkle_leaf_hash
        : typeof leaf.leaf_hash === "string" && leaf.leaf_hash
            ? leaf.leaf_hash
            : undefined;
    return { merkle_root, merkle_leaf_hash };
}
