/** Canonical Affix API host for verify, attest, flush (not for QR/barcode presentment). */
export const DEFAULT_AFFIX_API_BASE = "https://api.affix-io.com";
/** Default path segment when building a user-supplied presentment URL. */
export const DEFAULT_PRESENTMENT_PATH = "/v";
export function normaliseApiBase(base) {
    const raw = (base ?? process.env.AFFIX_API_BASE ?? DEFAULT_AFFIX_API_BASE).trim();
    return raw.replace(/\/$/, "") || DEFAULT_AFFIX_API_BASE;
}
/**
 * Normalise a customer presentment base. Empty/unset → no link.
 * Never defaults to AffixIO; hosts set this themselves.
 */
export function normalisePresentmentBase(base) {
    const raw = (base ?? process.env.AFFIX_PRESENTMENT_BASE ?? "").trim();
    if (!raw)
        return undefined;
    return raw.replace(/\/$/, "");
}
/**
 * Build a presentment URL from a customer-supplied base + ZK carrier.
 * Returns undefined when no base is configured (codes stay as raw AFX.ZK1…).
 */
export function buildPresentmentLink(carrier, presentmentBase, pathPrefix = DEFAULT_PRESENTMENT_PATH) {
    const base = normalisePresentmentBase(presentmentBase);
    if (!base)
        return undefined;
    const path = pathPrefix.startsWith("/") ? pathPrefix : `/${pathPrefix}`;
    const payload = String(carrier).trim();
    return `${base}${path}/${encodeURIComponent(payload)}`;
}
/**
 * Extract a ZK carrier from a scanned string.
 * Accepts raw AFX.ZK1… payloads or any https://…/v/… style URL the host configured.
 */
export function extractCarrierFromScan(scanned) {
    const raw = String(scanned).trim();
    if (!raw)
        return raw;
    if (raw.startsWith("AFX.ZK1."))
        return raw;
    if (/^affix:\/\/v\//i.test(raw)) {
        return decodeURIComponent(raw.replace(/^affix:\/\/v\//i, ""));
    }
    try {
        if (/^https?:\/\//i.test(raw)) {
            const url = new URL(raw);
            const parts = url.pathname.split("/").filter(Boolean);
            const vIdx = parts.findIndex((p) => p === "v");
            if (vIdx >= 0 && parts[vIdx + 1]) {
                return decodeURIComponent(parts.slice(vIdx + 1).join("/"));
            }
            const token = url.searchParams.get("token") || url.searchParams.get("data");
            if (token)
                return decodeURIComponent(token);
        }
    }
    catch {
        /* fall through */
    }
    const marker = raw.indexOf("/v/");
    if (marker >= 0) {
        return decodeURIComponent(raw.slice(marker + 3).split(/[?#]/)[0] ?? "");
    }
    return raw;
}
