export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface LocalAttestation {
  schema: string;
  algorithm: string;
  signed_at: string;
  payload_digest: string;
  key_id: string;
  hmac_b64: string;
  mldsa_signature_b64: string;
  mldsa_public_key_b64: string;
}
export interface EvidenceBundle {
  manifest: { schema: "affix.evidence.v1"; createdAt: string; entries: { name: string; digest: string }[] };
  artifacts: { name: string; data: Json }[];
  signature: LocalAttestation | null;
}
export interface EvidenceVerification {
  integrityValid: boolean;
  signatureValid: boolean;
  reason: string;
  artifactCount: number;
  zeroKnowledgeVerified: false;
  remoteAttestationVerified: false;
}
export interface TrustOptions {
  /** Pinned ML-DSA-65 public keys (base64). */
  trustedPublicKeys?: string[];
  /** Published key set ({ keys: [...] }), list of { key_id, public_key_b64 }, or { key_id: b64 } map. */
  trustedKeys?: { keys: { key_id?: string; public_key_b64: string; algorithm?: string; status?: string; not_before?: string | null; not_after?: string | null }[] } | { key_id?: string; public_key_b64: string }[] | Record<string, string> | string;
  /** TESTS ONLY. Trust the key embedded in the envelope. */
  insecureTrustEmbeddedKey?: boolean;
  /** Accept v1 envelopes (unsigned signed_at) when a key validity window applies. Insecure; migration only. */
  allowLegacyUnsignedTime?: boolean;
  /** Reject legacy v1 envelopes. */
  rejectLegacyV1?: boolean;
  /** Bind: the envelope must commit to this proof (payload.proof or proof_digest) ... */
  proof?: string;
  /** ... and this circuit (or proof_mode when the payload has no circuit_id). */
  circuitId?: string;
  proofMode?: string;
  /** Expected decision. Since 2.0.2 the envelope must carry a matching decision (envelope_decision_missing otherwise). */
  decision?: string;
  /** Accept an envelope without a decision when `decision` is given. Not recommended. */
  allowMissingDecision?: boolean;
  /** Verify the signature only (no proof binding). Result is marked unbound and a warning is emitted. */
  allowUnbound?: boolean;
}
export declare function sha256(value: Json): Promise<string>;
export declare function verifyPublicEnvelope(envelope: { payload: Json; attestation: LocalAttestation }, options?: TrustOptions): Promise<{ valid: boolean; reason: string; bound: boolean; binding: "checked" | "skipped" | "missing"; unbound?: true; hmacVerified?: false; zeroKnowledgeVerified?: false }>;
export declare function verifyEvidenceBundle(bundle: EvidenceBundle, options?: TrustOptions): Promise<EvidenceVerification>;
export declare function renderEvidenceSummary(element: HTMLElement, result: EvidenceVerification): void;
