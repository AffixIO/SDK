import { clone, required } from "./canonical.js";
import { digest } from "./budget.js";
import { signLocalPayload } from "../local-signing.js";

export function createEvidenceBundle(artifacts, { signing, createdAt = new Date().toISOString() } = {}) {
  if (!Array.isArray(artifacts) || !artifacts.length) throw new TypeError("Artifacts required");
  const names = new Set();
  for (const artifact of artifacts) {
    required(artifact.name, "artifact name");
    if (names.has(artifact.name)) throw new Error("Duplicate artifact name");
    names.add(artifact.name);
  }
  const copied = clone(artifacts);
  const manifest = { schema: "affix.evidence.v1", createdAt, entries: copied.map(({ name, data }) => ({ name, digest: digest(data) })) };
  return { manifest, artifacts: copied, signature: signing ? signLocalPayload(manifest, signing) : null };
}

export function describeEvidence(proof) {
  return { proofMode: proof?.proof_mode ?? proof?.proofMode ?? "unknown",
    hasEnvelope: Boolean(proof?.envelope?.attestation), hasRemoteAttestation: Boolean(proof?.attestation),
    cryptographicallyVerified: false,
    statement: "Presence of a proof or signature is not verification. Source truth requires independent checks." };
}

const escape = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

export function evidenceReport(bundle, result) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>AffixIO evidence report</title><style>body{font:16px/1.6 system-ui,sans-serif;color:#202526;background:#f6f8f8;margin:0}main{max-width:960px;margin:auto;padding:32px 24px}h1{font-size:28px}h2{font-size:20px}table{border-collapse:collapse;width:100%;background:white}td,th{text-align:left;padding:12px;border-bottom:1px solid #cad3d4;overflow-wrap:anywhere}code{font-size:12px;word-break:break-all}.good{color:#096047}.warn{color:#8b3610}</style></head><body><main><h1>AffixIO evidence report</h1><p>${escape(bundle.manifest.createdAt)}</p><p class="${result.signatureValid ? "good" : "warn"}">${result.signatureValid ? "Trusted manifest signature verified" : "Manifest signature not verified"}</p><p>Integrity: ${result.integrityValid ? "valid" : "invalid"}. Zero-knowledge proofs and remote attestations are not checked by this report. Hashes establish consistency, not the truth of source material.</p><h2>Evidence manifest</h2><table><thead><tr><th>Artifact</th><th>SHA-256</th></tr></thead><tbody>${bundle.manifest.entries.map(entry => `<tr><td>${escape(entry.name)}</td><td><code>${escape(entry.digest)}</code></td></tr>`).join("")}</tbody></table></main></body></html>`;
}
