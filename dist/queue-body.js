import { defaultContext } from "./witness.js";
const WITNESS_PKG = "@affix-io/sdk-witness";
async function loadWitnessBuilder() {
    try {
        const mod = await import(WITNESS_PKG);
        if (typeof mod.buildLocalWitness !== "function") {
            throw new Error("witness_export_missing");
        }
        return mod.buildLocalWitness;
    }
    catch {
        throw new Error("offline_witness_unavailable: credential-based offline queue requires the private @affix-io/sdk-witness package. " +
            "Install it from AffixIO, or pass witness/fields instead of credential, or set queueOnFailure: false.");
    }
}
/** Strip credential/context; persist witness-only bodies for offline resume. */
export async function redactProveBodyForQueue(circuitId, body) {
    const out = {
        requestAttestation: body.requestAttestation,
        sector: body.sector,
        circuit_id: body.circuit_id ?? circuitId,
    };
    if (body.witness && typeof body.witness === "object") {
        out.witness = body.witness;
        return out;
    }
    const credential = body.credential;
    if (credential) {
        const buildLocalWitness = await loadWitnessBuilder();
        const context = defaultContext(body.context ?? {});
        out.witness = buildLocalWitness(circuitId, credential, context);
        return out;
    }
    if (body.fields) {
        out.fields = body.fields;
    }
    return out;
}
