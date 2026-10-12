/* Credit: @paparichens */
import { existsSync } from "node:fs";
import { requestJson } from "./http.js";

/** Supported HSM families: hardware PKCS#11 and major cloud KMS/HSM services. */
export const HSM_PROVIDERS = [
    "pkcs11",
    "softhsm",
    "aws_cloudhsm",
    "aws_kms",
    "azure_key_vault",
    "azure_managed_hsm",
    "gcp_kms",
    "google_cloud_hsm",
    "thales",
    "utimaco",
    "ncipher",
    "yubihsm",
    "fortanix",
    "generic_http",
    "custom",
];

export function isHsmProvider(value) {
    return HSM_PROVIDERS.includes(value);
}

export function defaultHsmProfile(provider = "pkcs11") {
    return {
        enabled: true,
        provider,
        label: provider,
        key_label: null,
        key_id: null,
        slot: null,
        library_path: null,
        endpoint: null,
        region: null,
        project_id: null,
        vault_uri: null,
        cluster_id: null,
        pin_env: "AFFIX_HSM_PIN",
        password_env: "AFFIX_HSM_PASSWORD",
        access_key_env: null,
        secret_key_env: null,
        token_env: "AFFIX_HSM_TOKEN",
        client_cert_path: null,
        client_key_path: null,
        ca_cert_path: null,
        timeout_ms: 15_000,
        prefer_for_signing: false,
        meta: {},
    };
}

export function validateHsmProfile(profile) {
    if (!profile || typeof profile !== "object") {
        return { ok: false, error: "hsm_profile_required" };
    }
    if (!profile.provider || !isHsmProvider(profile.provider)) {
        return {
            ok: false,
            error: `unsupported_hsm_provider:${profile.provider ?? "none"}`,
            supported: HSM_PROVIDERS,
        };
    }
    const p = profile.provider;
    if ((p === "pkcs11" || p === "softhsm" || p === "thales" || p === "utimaco" || p === "ncipher" || p === "yubihsm")
        && !profile.library_path) {
        return { ok: false, error: "hsm_library_path_required" };
    }
    if ((p === "aws_cloudhsm" || p === "aws_kms") && !profile.region) {
        return { ok: false, error: "hsm_region_required" };
    }
    if ((p === "azure_key_vault" || p === "azure_managed_hsm") && !profile.vault_uri) {
        return { ok: false, error: "hsm_vault_uri_required" };
    }
    if ((p === "gcp_kms" || p === "google_cloud_hsm") && !profile.project_id) {
        return { ok: false, error: "hsm_project_id_required" };
    }
    if ((p === "generic_http" || p === "fortanix" || p === "custom") && !profile.endpoint) {
        return { ok: false, error: "hsm_endpoint_required" };
    }
    return { ok: true };
}

function envPresent(name) {
    return Boolean(name && process.env[name]);
}

function credentialStatus(profile) {
    return {
        pin: envPresent(profile.pin_env),
        password: envPresent(profile.password_env),
        token: envPresent(profile.token_env),
        access_key: envPresent(profile.access_key_env),
        secret_key: envPresent(profile.secret_key_env),
    };
}

async function probePkcs11(profile) {
    const library = profile.library_path;
    if (!library) {
        return { ok: false, stage: "config", error: "library_path_missing" };
    }
    if (!existsSync(library)) {
        return { ok: false, stage: "library", error: `library_not_found:${library}` };
    }
    let pkcs11;
    try {
        pkcs11 = await import("pkcs11js");
    }
    catch {
        return {
            ok: true,
            stage: "library",
            mode: "path_check",
            message: "PKCS#11 library path exists. Install optional package pkcs11js for live session probes.",
            library_path: library,
            credentials: credentialStatus(profile),
        };
    }
    try {
        const mod = pkcs11.default ?? pkcs11;
        const PKCS11 = mod.PKCS11 ?? mod;
        const session = new PKCS11();
        session.load(library);
        session.C_Initialize();
        try {
            const slots = session.C_GetSlotList(true);
            return {
                ok: true,
                stage: "session",
                mode: "pkcs11",
                slots: slots.length,
                library_path: library,
                credentials: credentialStatus(profile),
            };
        }
        finally {
            try {
                session.C_Finalize();
            }
            catch {
                /* ignore */
            }
        }
    }
    catch (err) {
        return {
            ok: false,
            stage: "session",
            error: err instanceof Error ? err.message : String(err),
            library_path: library,
        };
    }
}

async function probeHttpEndpoint(profile, path = "/") {
    const base = String(profile.endpoint).replace(/\/$/, "");
    const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
    const headers = { Accept: "application/json" };
    if (profile.token_env && process.env[profile.token_env]) {
        headers.Authorization = `Bearer ${process.env[profile.token_env]}`;
    }
    try {
        const res = await requestJson(url, {
            method: "GET",
            headers,
            timeoutMs: profile.timeout_ms ?? 15_000,
        });
        return {
            ok: res.ok || res.status === 401 || res.status === 403,
            status: res.status,
            url,
            credentials: credentialStatus(profile),
            message: res.ok
                ? "Endpoint reachable"
                : `Endpoint responded with HTTP ${res.status} (credentials may still be required)`,
        };
    }
    catch (err) {
        return {
            ok: false,
            url,
            error: err instanceof Error ? err.message : String(err),
            credentials: credentialStatus(profile),
        };
    }
}

async function probeAws(profile) {
    if (!profile.region) {
        return { ok: false, error: "region_required" };
    }
    const endpoint = profile.endpoint
        ?? (profile.provider === "aws_kms"
            ? `https://kms.${profile.region}.amazonaws.com`
            : `https://cloudhsmv2.${profile.region}.amazonaws.com`);
    return {
        ok: true,
        stage: "config",
        mode: profile.provider,
        region: profile.region,
        endpoint,
        cluster_id: profile.cluster_id ?? null,
        key_id: profile.key_id ?? null,
        credentials: credentialStatus({
            ...profile,
            access_key_env: profile.access_key_env ?? "AWS_ACCESS_KEY_ID",
            secret_key_env: profile.secret_key_env ?? "AWS_SECRET_ACCESS_KEY",
        }),
        message: "AWS HSM/KMS profile stored. Use AWS SDK credentials in the environment for live signing.",
    };
}

async function probeAzure(profile) {
    const uri = String(profile.vault_uri).replace(/\/$/, "");
    try {
        const res = await requestJson(`${uri}/keys?api-version=7.4`, {
            method: "GET",
            headers: {
                Accept: "application/json",
                ...(process.env[profile.token_env ?? "AFFIX_HSM_TOKEN"]
                    ? { Authorization: `Bearer ${process.env[profile.token_env ?? "AFFIX_HSM_TOKEN"]}` }
                    : {}),
            },
            timeoutMs: profile.timeout_ms ?? 15_000,
        });
        return {
            ok: res.ok || res.status === 401,
            status: res.status,
            vault_uri: uri,
            credentials: credentialStatus(profile),
            message: res.ok
                ? "Azure vault reachable"
                : `Azure vault responded HTTP ${res.status}`,
        };
    }
    catch (err) {
        return {
            ok: false,
            vault_uri: uri,
            error: err instanceof Error ? err.message : String(err),
            credentials: credentialStatus(profile),
        };
    }
}

async function probeGcp(profile) {
    return {
        ok: true,
        stage: "config",
        mode: profile.provider,
        project_id: profile.project_id,
        key_id: profile.key_id ?? null,
        region: profile.region ?? null,
        credentials: {
            ...credentialStatus(profile),
            google_application_credentials: Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS),
        },
        message: "GCP KMS/HSM profile stored. Set GOOGLE_APPLICATION_CREDENTIALS for live signing.",
    };
}

/**
 * Probe an HSM connection profile without writing secrets into config.
 */
export async function testHsmConnection(profile) {
    const validation = validateHsmProfile(profile);
    if (!validation.ok) {
        return { ok: false, ...validation };
    }
    const provider = profile.provider;
    if (provider === "pkcs11" || provider === "softhsm" || provider === "thales"
        || provider === "utimaco" || provider === "ncipher" || provider === "yubihsm") {
        return probePkcs11(profile);
    }
    if (provider === "aws_cloudhsm" || provider === "aws_kms") {
        return probeAws(profile);
    }
    if (provider === "azure_key_vault" || provider === "azure_managed_hsm") {
        return probeAzure(profile);
    }
    if (provider === "gcp_kms" || provider === "google_cloud_hsm") {
        return probeGcp(profile);
    }
    if (provider === "generic_http" || provider === "fortanix" || provider === "custom") {
        return probeHttpEndpoint(profile, profile.meta?.health_path ?? "/");
    }
    return { ok: false, error: `unhandled_provider:${provider}` };
}

export function summariseHsmProfile(profile) {
    if (!profile) {
        return { configured: false };
    }
    return {
        configured: true,
        enabled: profile.enabled !== false,
        provider: profile.provider,
        label: profile.label ?? profile.provider,
        key_label: profile.key_label ?? null,
        key_id: profile.key_id ?? null,
        library_path: profile.library_path ?? null,
        endpoint: profile.endpoint ?? null,
        region: profile.region ?? null,
        vault_uri: profile.vault_uri ?? null,
        project_id: profile.project_id ?? null,
        prefer_for_signing: Boolean(profile.prefer_for_signing),
        credentials: credentialStatus(profile),
    };
}
