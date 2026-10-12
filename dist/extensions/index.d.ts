export interface SignedTreeHead {
  root: string;
  seq: number;
  leaf_count: number;
  updated_at: string;
  signature_b64: string;
  alg: string;
}
export interface MerkleTree {
  leafHashes: string[];
  root: string;
  layers: string[][];
  leaf_count: number;
}
export interface ConsistencyProof {
  algorithm: string;
  old_size: number;
  new_size: number;
  old_root: string;
  new_root: string;
  nodes: string[];
  new_leaves: string[];
}
export interface OperatorMode {
  description: string;
  licenceOnly: boolean;
  autoFlush: boolean;
  allowRemoteVerify: boolean;
  allowFlush: boolean;
  queueUnsyncedProofs: boolean;
}
export const STH_ALG: string;
export const STH_DOMAIN: string;
export function sthMessage(sth: Pick<SignedTreeHead, "root" | "seq" | "leaf_count" | "updated_at">): Buffer;
/** publicKey: one pinned key, or a pinned key set ({ keys: [...] }, list, or key_id map). */
export function verifySignedRoot(sth: SignedTreeHead, publicKey: unknown, options?: object): boolean;
export function fetchSignedRoot(client: unknown, options?: object): Promise<object>;
export function createMockSthSigner(seed?: Buffer | Uint8Array): {
  publicKey: Uint8Array;
  public_key_b64: string;
  signSth(partial: Partial<Pick<SignedTreeHead, "root" | "seq" | "leaf_count" | "updated_at">>): SignedTreeHead;
};
export function normalizePublicKey(publicKey: unknown): Uint8Array;
export function proveConsistency(oldTree: MerkleTree, newTree: MerkleTree): ConsistencyProof;
export function proveConsistencyWithLeaves(oldLeaves: string[], newLeaves: string[]): ConsistencyProof;
export function verifyConsistency(oldRoot: string, newRoot: string, proof: ConsistencyProof): boolean;
export function rootFromLeaves(leaves: string[]): string;
export function hashNode(left: string, right: string): string;
/** input.trustedKeys (or trustedPublicKey) is required when input.attestation is present (2.0.0-beta.2). */
export function verifyArtifactOffline(input?: { attestation?: object; attestationPayload?: unknown; proof?: unknown; hmacSecret?: string; trustedKeys?: unknown; trustedPublicKey?: unknown; insecureTrustEmbeddedKey?: boolean; sth?: object; publicKey?: unknown; inclusion?: object; [k: string]: unknown }): { ok: boolean; checks: object[]; errors: string[] };
export const SPEND_ARTIFACT_SCHEMA: string;
export function exportSpendJournal(source: unknown): object;
export function verifySpendJournalArtifact(artifact: object): { ok: boolean; error?: string };
export function buildDemoSpendArtifact(dir: string): Promise<{ artifact: object }>;
export const OPERATOR_MODE_PRESETS: Record<"local" | "licence" | "anchored", OperatorMode>;
export function resolveOperatorMode(mode: "local" | "licence" | "anchored"): OperatorMode & { mode: "local" | "licence" | "anchored" };
export function createAffixClient(options?: object): object;
export function runDoctor(options?: object): Promise<{ ok: boolean; checks: object[]; errors: string[]; summary: string }>;
export function assertDoctorHealthy(report: { ok: boolean; errors?: string[] }): void;
export function hashLeaf(data: string | Buffer | Uint8Array): string;
export function affixHashNode(left: string, right: string): string;
export function emptyMerkleRoot(): string;
export function leafHashFromDigest(digest: string): string;
export function treeFromLeaves(leafHashes: string[]): MerkleTree;
export function buildMerkleTree(leaves: string[]): Pick<MerkleTree, "root" | "layers">;
export function verifyMerkleProof(leaf: string, root: string, proof: object[]): boolean;
export declare const EMPTY_POLICY_HASH: string;
export declare const EMPTY_POLICY_SENTINEL: Readonly<{ "affix.policy": null }>;
export declare const ATTESTATION_SCHEMA: string;
export declare const ENVELOPE_SCHEMA: string;
export declare function canonicalPolicyHash(policy: unknown): string;
export declare function resolvePolicyHash(input?: object): string;
export declare function buildVersionBinding(options?: object): {
  sdk_version: string;
  circuit_id: string | null;
  attestation_schema: string;
  envelope_schema: string;
  policy_revision: number | null;
};
export declare function bindPolicyIntoPayload(payload: object, options?: object): object;
