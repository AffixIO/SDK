/* AffixIO Know Your Agent. Credit: @paparichens */
import { createHash, randomUUID } from "node:crypto";
import { CapabilityPolicy } from "./policy.js";
import {
  KYA_CIRCUIT,
  issueAgentCredential,
  verifyAgentCredential,
} from "./identity.js";

export const DEFAULT_API_BASE = "https://api.affix-io.com";
export const DEFAULT_HUB_URL = "https://hub.affix-io.com";

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function argsDigest(args) {
  if (args === undefined) return "none";
  try {
    return sha256Hex(JSON.stringify(args));
  } catch {
    return sha256Hex(String(args));
  }
}

/**
 * Know Your Agent control plane.
 * Pass an AffixSDK instance (from `new AffixSDK({ apiKey })`) or use `createAgentTrust()`.
 */
export class AgentTrust {
  constructor(options = {}) {
    if (!options.sdk) {
      throw new Error(
        "AgentTrust requires options.sdk (AffixSDK). Use createAgentTrust({ apiKey }) from affixio.",
      );
    }
    this.sdk = options.sdk;
    this.ownsSdk = Boolean(options.ownsSdk);
    this.apiBase = options.apiBase ?? this.sdk.apiBase ?? DEFAULT_API_BASE;
    this.hubUrl = options.hubUrl ?? process.env.AFFIX_HUB_URL ?? DEFAULT_HUB_URL;
    this.apiKey = options.apiKey ?? null;
    this.receipts = [];
    this.policies = new Map();
  }

  async enrol({ agentId, holder, model, capabilities = [], ttlSeconds, metadata }) {
    const policy = new CapabilityPolicy(capabilities);
    const credential = await issueAgentCredential(this.sdk, {
      agentId,
      holder,
      model,
      capabilities: policy,
      ttlSeconds,
      metadata,
    });
    this.policies.set(agentId, policy);
    return credential;
  }

  verifyCredential(credential) {
    return verifyAgentCredential(credential, this.sdk);
  }

  async authorise({ credential, action, resource, args, attest = false } = {}) {
    if (!credential?.agent_id) {
      throw new Error("authorise requires a credential");
    }

    const credentialCheck = await this.verifyCredential(credential);
    if (!credentialCheck.valid) {
      return {
        allowed: false,
        decision: "no",
        reason: `credential_${credentialCheck.reason}`,
        action,
        resource,
        matched_capability: null,
        attested: false,
      };
    }

    let policy = this.policies.get(credential.agent_id);
    if (!policy) {
      policy = new CapabilityPolicy(credential.capabilities ?? []);
      this.policies.set(credential.agent_id, policy);
    }

    const verdict = policy.decide({ action, resource });
    const nonce = randomUUID();
    const contextId = `0x${sha256Hex(
      `${credential.agent_id}|${action}|${resource ?? "*"}|${argsDigest(args)}|${nonce}`,
    )}`;

    const proveInput = {
      mode: attest ? "online" : "offline",
      proofMode: "hmac",
      circuitId: KYA_CIRCUIT,
      decision: verdict.allow ? "yes" : "no",
      credential: { claim_value: verdict.allow ? "allow" : "deny" },
      context: {
        secret: `0x${sha256Hex(credential.agent_id)}`,
        context_id: contextId,
        required_claim_hash: "allow",
      },
      queueForSync: false,
      origin: "agent_action",
      meta: { action: String(action), resource: String(resource ?? "*") },
    };

    let proved;
    let attestation = null;
    let attested = false;

    if (attest) {
      try {
        const online = await this.sdk.isOnline();
        if (online) {
          const result = await this.sdk.proveAndVerify(proveInput);
          proved = result.prove;
          attestation = result.verify?.attestation ?? result.prove?.signature ?? null;
          attested = Boolean(
            attestation?.mldsa_signature_b64 || attestation?.signature_b64,
          );
        } else {
          proved = await this.sdk.prove({ ...proveInput, mode: "offline" });
        }
      } catch {
        proved = await this.sdk.prove({ ...proveInput, mode: "offline" });
      }
    } else {
      proved = await this.sdk.prove({ ...proveInput, mode: "offline" });
    }

    const receipt = {
      agent_id: credential.agent_id,
      action: String(action),
      resource: resource ? String(resource) : "*",
      allowed: verdict.allow && proved.decision === "yes",
      decision: proved.decision,
      reason: verdict.reason,
      matched_capability: verdict.matched,
      proof_id: proved.proof_id,
      circuit_id: proved.circuit_id,
      proof_digest: proved.proof_digest,
      proof: proved.proof,
      attested,
      attestation,
      at: new Date().toISOString(),
    };

    this.receipts.push(receipt);
    return receipt;
  }

  async buildAuditTrail(options = {}) {
    const source = options.receipts ?? this.receipts;
    if (source.length === 0) {
      return { leaf_count: 0, merkle_root: null, receipts: 0 };
    }
    const items = source.map((r) => ({
      proof_id: r.proof_id,
      circuit_id: r.circuit_id,
      proof_digest: r.proof_digest,
      proof: r.proof,
    }));
    const batch = await this.sdk.buildMerkleBatch(items);
    return {
      leaf_count: batch.leaves?.length ?? items.length,
      merkle_root: batch.root ?? batch.merkle_root ?? null,
      batch_id: batch.batch_id ?? null,
      receipts: source.length,
    };
  }

  async badge(credential, options = {}) {
    return this.sdk.generateCode({
      kind: options.kind ?? "qr",
      circuitId: credential.circuit_id,
      proof: credential.proof,
      proofDigest: credential.proof_digest,
      embedProof: options.embedProof ?? true,
      format: options.format ?? "svg",
      queueForSync: false,
    });
  }

  async scanBadge(carrier, options = {}) {
    return this.sdk.readCode({
      scanned: typeof carrier === "string" ? carrier.trim() : carrier,
      mode: options.mode ?? "offline",
      consume: options.consume ?? false,
      queueForSync: false,
    });
  }

  dispose() {
    if (this.ownsSdk && this.sdk) {
      this.sdk.dispose();
    }
  }
}
