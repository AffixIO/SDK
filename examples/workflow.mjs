// Offline workflow example: decision -> human review -> simulated action -> signed, pinned evidence.
// Nothing real is sent or charged. The signing key is generated here for the demo only;
// in production the verifier must obtain the signer's PUBLIC key independently.
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { createLocalSigningKeyPair } from "affixio";
import { FileStore, DecisionPipeline, WorkflowSession, createEvidenceBundle, verifyEvidenceBundle } from "affixio/workflows";

const directory = await mkdtemp(join(tmpdir(), "affix-workflow-"));
try {
  const store = new FileStore(join(directory, "state.json"));
  const policy = {
    id: "intro-permission", version: "1", mode: "all", requireReview: true,
    rules: [
      { source: "consent", operator: "truthy", maxAgeMs: 60000 },
      { source: "recipient", operator: "eq", value: "approved", maxAgeMs: 60000 },
    ],
  };
  const pipeline = new DecisionPipeline({ sources: {
    consent: async () => ({ value: true }),
    recipient: async () => ({ value: "approved" }),
  } });
  const intent = { recipientRef: "recipient-123", action: "introduce" };
  const result = await pipeline.evaluate(policy, intent);
  // Approval binding is the caller's job: check the authenticated reviewer AND that the approval
  // they gave matches this exact action (action.id, action.binding, action.result.policyDigest).
  const approvedTicket = { actor: "example-owner", actionId: "intro-1" };
  const options = { store, scope: "example-tenant", sessionId: "intro-session",
    authorizeReview: ({ actor, action }) => actor === approvedTicket.actor && action.id === approvedTicket.actionId };
  const first = new WorkflowSession(options);
  first.propose({ id: "intro-1", intent, policy, result });
  const resumed = new WorkflowSession(options); // simulated restart: same store, new session object
  await resumed.review("intro-1", { actor: "example-owner", decision: "approve" });
  const executed = await resumed.execute("intro-1", async (intent, { idempotencyKey }) => ({ simulated: true, action: intent.action, requestId: idempotencyKey }));

  const keys = createLocalSigningKeyPair();
  const signing = { hmacSecret: randomBytes(32).toString("hex"), secretKeyB64: keys.secret_key_b64, publicKeyB64: keys.public_key_b64 }; // hmacSecret: at least 16 characters
  const bundle = createEvidenceBundle([{ name: "workflow", data: executed.record }], { signing });
  const evidence = await verifyEvidenceBundle(bundle, { trustedPublicKeys: [keys.public_key_b64] }); // pinned key, never the embedded one
  console.log(JSON.stringify({ state: executed.record.state, action: executed.value, evidence }, null, 2));
} finally { await rm(directory, { recursive: true, force: true }); }
