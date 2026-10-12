import type { ProveResult } from "../types.js";
export type CodeKind = "qr" | "barcode";
export type CodeFormat = "svg" | "png";
export type CodeCarrierMode = "full" | "compact";
/** 0 or "unlimited" = no scan cap; 1–255 = max admissions per gate. */
export type MaxUsesOption = number | "unlimited";
export type ZkCodeHeader = {
    version: 1;
    mode: CodeCarrierMode;
    circuit_id: "simple_yesno" | "yesno";
    decision: "yes" | "no";
    max_uses: number;
    exp: number;
    valid_from: number;
    code_id: string;
    proof_digest: string;
    proof_id?: string;
};
export type ZkCodePayload = ZkCodeHeader & {
    proof_hex?: string;
    public_inputs?: string[];
};
export type GenerateCodeInput = {
    kind?: CodeKind;
    symbology?: string;
    format?: CodeFormat | "both";
    /** Default true: prefer embedding full ZK proof when symbology capacity allows. */
    embedProof?: boolean;
    /**
     * What to encode in the QR/barcode image.
     * carrier (default): raw AFX.ZK1…
     * link: only when presentmentBase is set by the host
     */
    presentment?: "carrier" | "link";
    /** Override SDK presentmentBase for this code only (customer URL, not AffixIO). */
    presentmentBase?: string;
    maxUses?: MaxUsesOption;
    exp?: number;
    validFrom?: number;
    ecLevel?: "L" | "M" | "Q" | "H";
    label?: string;
    save?: {
        /** Directory or full file path prefix (without extension). */
        path?: string;
        /** Write sidecar JSON with full proof (default true when compact). */
        sidecar?: boolean;
    };
    prove?: ProveResult;
    circuitId?: string;
    proof?: string;
    proofDigest?: string;
    mode?: "auto" | "offline" | "online";
    queueForSync?: boolean;
};
export type GenerateCodeFromProveInput = Omit<GenerateCodeInput, "prove" | "proof"> & {
    circuitId?: string;
    credential?: import("../types.js").AffixCredential;
    context?: Partial<import("../types.js").WitnessContext>;
    fields?: Record<string, string | number | boolean>;
    witness?: import("../types.js").WitnessPackage;
};
export type SavedCodeFiles = {
    svg?: string;
    png?: string;
    sidecar?: string;
    content?: string;
};
export type GeneratedCode = {
    code_id: string;
    kind: CodeKind;
    symbology: string;
    carrier_mode: CodeCarrierMode;
    /** Payload encoded in the QR/barcode image (raw carrier, or host link if configured). */
    content: string;
    /** Raw AFX.ZK1… carrier (always present). */
    carrier: string;
    /** Presentment URL only when the host set presentmentBase. */
    link?: string;
    header: ZkCodeHeader;
    prove: ProveResult;
    max_uses: number;
    uses_remaining: number | null;
    pii_free: true;
    files: SavedCodeFiles;
    svg?: string;
    png?: Buffer;
};
export type ReadCodeInput = {
    /** Raw text from any QR/barcode scanner. */
    scanned: string;
    /** Optional sidecar path or directory containing matching `.zk.json`. */
    sidecarPath?: string;
    /** Gate id for local use counting (default "default"). */
    gateId?: string;
    /** When true, increment local use count on admit (default false for verify-only). */
    consume?: boolean;
    /**
     * auto: Affix sign when online; local ZK admit + queue when offline (default).
     * online: Affix verify + ML-DSA attestation required.
     * offline: local ZK only; queue proof for Affix sign on flush.
     */
    mode?: "auto" | "offline" | "online";
    /** Request Affix ML-DSA attestation when signing (default true). */
    requestAttestation?: boolean;
    /** Queue offline admits for later Affix sign (default true). */
    queueForSync?: boolean;
    /**
     * @deprecated Prefer mode. true → try Affix; with allowOfflineAdmit maps to auto.
     */
    signOnline?: boolean;
    /** @deprecated Prefer mode: "offline" or auto. */
    allowOfflineAdmit?: boolean;
    /** @deprecated Use mode / signOnline. */
    verifyOnline?: boolean;
};
export type ReadCodeResult = {
    admitted: boolean;
    offline: boolean;
    /** Offline admit queued for Affix verify/attest on flush. */
    pending_sync?: boolean;
    reason?: string;
    header?: ZkCodeHeader;
    decision?: "yes" | "no";
    uses_remaining?: number | null;
    verify?: {
        valid: boolean;
        source: "local" | "remote";
        attested?: boolean;
    };
    /** Affix verify + attestation payload when online sign succeeded. */
    attestation?: import("../types.js").Attestation;
    signed?: import("../types.js").VerifyResult;
};
