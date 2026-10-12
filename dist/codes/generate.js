import { buildPresentmentLink, extractCarrierFromScan } from "../constants.js";
import { isLightProof } from "../light-prove.js";
import { localVerify, unpackProof } from "../local-prove.js";
import { buildHeader, carrierBinarySize, packCarrier, selectSymbology, unpackCarrier, } from "./carrier.js";
import { renderCode } from "./render.js";
import { loadSidecar, saveCodeAssets } from "./save.js";
import { CodeUseStore, resolveSidecarPath } from "./spent-store.js";
function usesRemaining(maxUses, currentUses) {
    if (maxUses === 0)
        return null;
    return Math.max(0, maxUses - currentUses);
}
function resolvePresentment(input, hasLinkBase) {
    if (input.presentment === "link") {
        if (!hasLinkBase) {
            throw new Error("presentment_link_requires_base: set presentmentBase (or AFFIX_PRESENTMENT_BASE) to your own URL");
        }
        return "link";
    }
    return "carrier";
}
export async function generateZkCode(sdk, input) {
    let proved;
    if (input.prove) {
        proved = input.prove;
    }
    else if (input.proof && input.circuitId && input.proofDigest) {
        proved = {
            proof_id: input.proofDigest.slice(0, 32),
            circuit_id: input.circuitId,
            proof: input.proof,
            valid: true,
            decision: "yes",
            proof_digest: input.proofDigest,
            source: "local",
            offline: true,
            pending_sync: false,
        };
    }
    else {
        throw new Error("generateCode_requires_prove_or_proof");
    }
    const kind = input.kind ?? "qr";
    const isHmac = proved.proof_mode === "hmac" || isLightProof(proved.proof);
    const embedProof = isHmac ? false : (input.embedProof ?? true);
    let proofData;
    if (embedProof) {
        proofData = unpackProof(proved.proof);
    }
    const fullBytes = embedProof ? carrierBinarySize("full", proofData) : 0;
    const selection = embedProof
        ? selectSymbology(kind, fullBytes, input.symbology)
        : {
            kind,
            symbology: input.symbology ?? (kind === "qr" ? "qrcode" : "code128"),
            mode: "compact",
        };
    const header = buildHeader({
        circuitId: proved.circuit_id,
        decision: proved.decision,
        proofDigest: proved.proof_digest,
        maxUses: input.maxUses,
        exp: input.exp,
        validFrom: input.validFrom,
        mode: selection.mode,
        proofId: proved.proof_id,
    });
    const carrier = packCarrier(header, selection.mode === "full" ? proofData : undefined);
    const linkBase = input.presentmentBase ?? sdk.presentmentBase;
    const link = buildPresentmentLink(carrier, linkBase);
    const presentment = resolvePresentment(input, Boolean(link));
    const content = presentment === "link" && link ? link : carrier;
    const format = input.format ?? "svg";
    const rendered = format === "both"
        ? {
            ...(await renderCode(selection.kind, content, {
                symbology: selection.symbology,
                format: "svg",
                ecLevel: input.ecLevel,
            })),
            ...(await renderCode(selection.kind, content, {
                symbology: selection.symbology,
                format: "png",
                ecLevel: input.ecLevel,
            })),
        }
        : await renderCode(selection.kind, content, {
            symbology: selection.symbology,
            format: format === "png" ? "png" : "svg",
            ecLevel: input.ecLevel,
        });
    const generated = {
        code_id: header.code_id,
        kind: selection.kind,
        symbology: selection.symbology,
        carrier_mode: selection.mode,
        content,
        carrier,
        link,
        header,
        prove: proved,
        max_uses: header.max_uses,
        uses_remaining: usesRemaining(header.max_uses, 0),
        pii_free: true,
        files: {},
        svg: rendered.svg,
        png: rendered.png,
    };
    generated.files = saveCodeAssets(generated, rendered, {
        path: input.save?.path,
        sidecar: input.save?.sidecar ?? selection.mode === "compact",
        basename: input.label,
    });
    await sdk.stats.bump("codes.issued");
    return generated;
}
export async function generateZkCodeFromProve(sdk, input) {
    const prove = await sdk.prove({
        circuitId: input.circuitId ?? "simple_yesno",
        credential: input.credential,
        context: input.context,
        fields: input.fields,
        witness: input.witness,
        mode: input.mode ?? "auto",
        queueForSync: input.queueForSync ?? true,
    });
    return generateZkCode(sdk, { ...input, prove });
}
async function resolveProofHex(sdk, payload, sidecarPath) {
    if (payload.proof_hex)
        return payload.proof_hex;
    if (sidecarPath) {
        const sidecar = loadSidecar(resolveSidecarPath(sidecarPath, payload.code_id));
        if (sidecar?.prove?.proof)
            return sidecar.prove.proof;
    }
    const stored = (await sdk.listStoredProofs()).find((p) => p.proof_digest === payload.proof_digest);
    if (stored?.proof)
        return stored.proof;
    return undefined;
}
async function applyAdmission(store, gateId, proofDigest, maxUses, consume) {
    return consume
        ? store.consume(gateId, proofDigest, maxUses)
        : store.checkAdmission(gateId, proofDigest, maxUses);
}
/**
 * Resolve scan connectivity mode.
 * auto: Affix when reachable, else local + queue.
 * online: Affix required.
 * offline: local only + queue.
 */
function resolveScanMode(input) {
    if (input.mode)
        return input.mode;
    if (input.signOnline === false || input.verifyOnline === false) {
        return input.allowOfflineAdmit === false ? "online" : "offline";
    }
    if (input.allowOfflineAdmit === true)
        return "auto";
    if (input.signOnline === true || input.verifyOnline === true)
        return "auto";
    return "auto";
}
/**
 * Scan a QR/barcode online or offline.
 * Local UltraHonk check always runs. Affix signs when mode allows and the API is up.
 * Offline admits are queued for Affix verify + ML-DSA attestation on flush.
 */
export async function readZkCode(sdk, input, useStore) {
    const gateId = input.gateId ?? "default";
    const store = useStore ?? new CodeUseStore();
    const mode = resolveScanMode(input);
    const requestAttestation = input.requestAttestation ?? true;
    const queueForSync = input.queueForSync ?? true;
    let payload;
    try {
        payload = unpackCarrier(extractCarrierFromScan(input.scanned));
    }
    catch (err) {
        return {
            admitted: false,
            offline: true,
            reason: err instanceof Error ? err.message : String(err),
        };
    }
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp > 0 && now > payload.exp) {
        return {
            admitted: false,
            offline: true,
            reason: "expired",
            header: payload,
            decision: payload.decision,
        };
    }
    if (payload.valid_from > 0 && now < payload.valid_from) {
        return {
            admitted: false,
            offline: true,
            reason: "not_yet_valid",
            header: payload,
            decision: payload.decision,
        };
    }
    const proofHex = await resolveProofHex(sdk, payload, input.sidecarPath);
    if (!proofHex) {
        return {
            admitted: false,
            offline: mode !== "online",
            reason: "compact_requires_sidecar_or_stored_proof",
            header: payload,
        };
    }
    const licenceOnly = sdk.config?.licenceOnly !== false;
    let local;
    if (typeof sdk.verifyLocal === "function") {
        local = await sdk.verifyLocal(payload.circuit_id, proofHex, {
            proofId: payload.proof_id ?? payload.code_id,
        });
    }
    else if (isLightProof(proofHex)) {
        return {
            admitted: false,
            offline: true,
            reason: "hmac_proof_requires_verifyLocal",
            header: payload,
        };
    }
    else {
        local = await localVerify(payload.circuit_id, proofHex);
    }
    if (!local.valid) {
        return {
            admitted: false,
            offline: true,
            reason: "zk_verify_failed",
            header: payload,
            decision: local.decision,
            verify: { valid: false, source: "local", attested: false },
        };
    }
    let signed;
    let signError;
    let tryAffix = !licenceOnly && (mode === "online" || mode === "auto");
    if (mode === "auto" && !licenceOnly) {
        const online = await sdk.isOnline();
        if (!online)
            tryAffix = false;
    }
    if (tryAffix) {
        try {
            signed = await sdk.verify(payload.circuit_id, proofHex, requestAttestation, {
                proofId: payload.proof_id ?? payload.code_id,
                proofDigest: payload.proof_digest,
                queueOnFailure: true,
            });
            if (!signed.verified && !signed.valid) {
                return {
                    admitted: false,
                    offline: false,
                    reason: "affix_verify_deny",
                    header: payload,
                    decision: signed.decision,
                    verify: { valid: false, source: "remote", attested: false },
                    signed,
                };
            }
        }
        catch (err) {
            signError = err instanceof Error ? err.message : String(err);
            if (mode === "online") {
                return {
                    admitted: false,
                    offline: false,
                    reason: `affix_sign_failed:${signError}`,
                    header: payload,
                    decision: local.decision,
                    verify: { valid: true, source: "local", attested: false },
                };
            }
            // auto/offline fall through to local admit
        }
    }
    const admission = await applyAdmission(store, gateId, payload.proof_digest, payload.max_uses, input.consume);
    if (!admission.admitted) {
        if (sdk.stats) {
            await sdk.stats.bump("codes.denied");
            await sdk.stats.bump("spend.double_spend_blocked");
        }
        return {
            admitted: false,
            offline: !signed,
            reason: admission.reason,
            header: payload,
            decision: signed?.decision ?? local.decision,
            uses_remaining: admission.remaining,
            verify: signed
                ? { valid: true, source: "remote", attested: Boolean(signed.attestation) }
                : { valid: true, source: "local", attested: false },
            attestation: signed?.attestation,
            signed,
        };
    }
    let pending_sync = false;
    if (!signed && queueForSync && !licenceOnly) {
        await sdk.queueProofForAffix({
            proof_id: payload.proof_id ?? `scan_${payload.code_id}`,
            circuit_id: payload.circuit_id,
            proof: proofHex,
            proof_digest: payload.proof_digest,
            valid: true,
            decision: local.decision,
            origin: "code_scan",
            meta: {
                code_id: payload.code_id,
                gate_id: gateId,
                scan_mode: mode,
            },
        });
        pending_sync = true;
    }
    if (sdk.stats) {
        await sdk.stats.bump("codes.admitted");
        if (input.consume)
            await sdk.stats.bump("spend.consumed");
    }
    const attested = Boolean(signed?.attestation);
    return {
        admitted: true,
        offline: !signed,
        pending_sync,
        header: payload,
        decision: signed?.decision ?? local.decision,
        uses_remaining: admission.remaining,
        verify: signed
            ? { valid: true, source: "remote", attested }
            : { valid: true, source: "local", attested: false },
        attestation: signed?.attestation,
        signed,
        reason: signed
            ? undefined
            : signError
                ? `offline_admit_queued:${signError}`
                : pending_sync
                    ? "offline_admit_queued"
                    : undefined,
    };
}
