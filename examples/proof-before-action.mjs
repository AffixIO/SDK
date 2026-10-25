import { AffixSDK, createReplayGuard, mcpToolGate, spendingPolicy } from "affixio";

const sdk = new AffixSDK({
  apiKey: process.env.AFFIX_API_KEY ?? "aio_demo",
  licenceOnly: true,
  autoFlush: false,
});

const policy = spendingPolicy()
  .currency("GBP")
  .maxPerAction(10)
  .allowCategories(["data"]);

const replayGuard = createReplayGuard({ windowMs: 24 * 60 * 60 * 1000 });

async function guardedTool({ amount, category = "data" }) {
  const gate = await mcpToolGate({
    sdk,
    policy,
    tool: "reports.export",
    agentId: "agent://demo/researcher",
    amount,
    currency: "GBP",
    category,
  });

  const proofCheck = await sdk.verifyLocal("simple_yesno", gate.proof.proof, {
    proofId: gate.proof.proof_id,
    envelope: gate.proof.envelope,
  });

  const replay = await replayGuard.check({
    id: gate.receipt.receipt_id,
    issuedAtMs: Date.parse(gate.proof.envelope.attestation.signed_at),
  });

  // This is the security boundary. Do not call the tool before this branch.
  if (!gate.allowed || !proofCheck.valid || !replay.ok) {
    return {
      executed: false,
      reason: gate.allowed ? (proofCheck.valid ? replay.reason : proofCheck.reason) : gate.reason,
      receipt: gate.receipt,
    };
  }

  return {
    executed: true,
    result: { report: "synthetic report", rows: 3 },
    receipt: gate.receipt,
  };
}

try {
  const allowed = await guardedTool({ amount: 4.5 });
  const denied = await guardedTool({ amount: 25 });

  console.log(JSON.stringify({ allowed, denied }, null, 2));
} finally {
  sdk.dispose();
}
