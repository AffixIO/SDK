import type { HsmProfile, HsmProvider } from "./types.js";
export type HsmValidation = {
    ok: boolean;
    error?: string;
    supported?: readonly HsmProvider[];
};
export type HsmProbeResult = {
    ok: boolean;
    stage?: string;
    mode?: string;
    error?: string;
    message?: string;
    status?: number;
    url?: string;
    slots?: number;
    library_path?: string | null;
    endpoint?: string | null;
    region?: string | null;
    vault_uri?: string | null;
    project_id?: string | null;
    cluster_id?: string | null;
    key_id?: string | null;
    credentials?: Record<string, boolean>;
};
export type HsmSummary = {
    configured: boolean;
    enabled?: boolean;
    provider?: HsmProvider;
    label?: string;
    key_label?: string | null;
    key_id?: string | null;
    library_path?: string | null;
    endpoint?: string | null;
    region?: string | null;
    vault_uri?: string | null;
    project_id?: string | null;
    prefer_for_signing?: boolean;
    credentials?: Record<string, boolean>;
};
/** Supported HSM families: hardware PKCS#11 and major cloud KMS/HSM services. */
export declare const HSM_PROVIDERS: readonly ["pkcs11", "softhsm", "aws_cloudhsm", "aws_kms", "azure_key_vault", "azure_managed_hsm", "gcp_kms", "google_cloud_hsm", "thales", "utimaco", "ncipher", "yubihsm", "fortanix", "generic_http", "custom"];
export declare function isHsmProvider(value: unknown): value is HsmProvider;
export declare function defaultHsmProfile(provider?: HsmProvider): HsmProfile;
export declare function validateHsmProfile(profile: any): HsmValidation;
/**
 * Probe an HSM connection profile without writing secrets into config.
 */
export declare function testHsmConnection(profile: HsmProfile): Promise<HsmProbeResult>;
export declare function summariseHsmProfile(profile: HsmProfile | null | undefined): HsmSummary;
