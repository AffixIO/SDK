/* AffixIO Know Your Agent. Credit: @paparichens */
import { createHash } from "node:crypto";
import { fieldInputHex } from "../field-crypto.js";

export const KYA_CIRCUIT = "simple_yesno";
export const ENROLLED_CLAIM = "enrolled";

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function identityBinding(agentId, capabilitiesDigest) {
  return `0x${sha256Hex(`${agentId}|${capabilitiesDigest}`)}`;
}

function decodeProof(proofHex) {
  try {
    return JSON.parse(Buffer.from(proofHex, "hex").toString("utf8"));
  } catch {
    return null;
  }
}

export async function issueAgentCredential(sdk, {
  agentId,
  holder,
  model,
  capabilities,
  ttlSeconds = 3600,
  metadata = {},
}) {
  if (!agentId) throw new Error("agentId is required");
  const capabilitiesDigest = capabilities.digest();
  const contextId = identityBinding(agentId, capabilitiesDigest);
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + ttlSeconds;

  const proved = await sdk.prove({
    mode: "offline",
    proofMode: "hmac",
    circuitId: KYA_CIRCUIT,
    decision: "yes",
    credential: { claim_value: ENROLLED_CLAIM },
    context: {
      secret: `0x${sha256Hex(agentId)}`,
      context_id: contextId,
      required_claim_hash: ENROLLED_CLAIM,
    },
    queueForSync: false,
    origin: "agent_enrol",
  });

  return {
    kind: "affix.kya.credential",
    agent_id: agentId,
    holder: holder ?? null,
    model: model ?? null,
    capabilities: capabilities.list(),
    capabilities_digest: capabilitiesDigest,
    issued_at: issuedAt,
    expires_at: expiresAt,
    metadata,
    circuit_id: proved.circuit_id,
    proof_id: proved.proof_id,
    proof_digest: proved.proof_digest,
    proof: proved.proof,
  };
}

export async function verifyAgentCredential(credential, sdk) {
  if (!credential || credential.kind !== "affix.kya.credential") {
    return { valid: false, reason: "not_a_credential" };
  }
  if (!sdk) {
    return { valid: false, reason: "missing_verification_key" };
  }

  const check = await sdk.verifyLocal(credential.circuit_id, credential.proof, {
    proofId: credential.proof_id,
  });
  if (!check.valid || check.decision !== "yes") {
    return { valid: false, reason: "proof_invalid" };
  }

  const expectedDigest = createHash("sha256")
    .update(
      JSON.stringify(
        (credential.capabilities ?? []).map((g) => [g.action, g.resource, g.maxPerRun]),
      ),
    )
    .digest("hex");
  if (expectedDigest !== credential.capabilities_digest) {
    return { valid: false, reason: "capabilities_tampered" };
  }

  const decoded = decodeProof(credential.proof);
  const boundContext = decoded?.inputs?.context_id;
  const expectedContext = fieldInputHex(
    identityBinding(credential.agent_id, expectedDigest),
  );
  if (boundContext && boundContext !== expectedContext) {
    return { valid: false, reason: "identity_binding_mismatch" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (now > credential.expires_at) {
    return { valid: false, reason: "expired" };
  }

  return { valid: true, reason: "enrolled", agent_id: credential.agent_id };
}
