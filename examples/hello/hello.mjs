import { AffixSDK, mcpToolGate, spendingPolicy } from "affixio";

// Offline: licenceOnly, no network calls. "aio_demo" is a placeholder key.
const sdk = new AffixSDK({ apiKey: process.env.AFFIX_API_KEY ?? "aio_demo", licenceOnly: true, autoFlush: false });
const policy = spendingPolicy().currency("GBP").maxPerAction(10);

for (const amount of [4.5, 25]) {
  const gate = await mcpToolGate({ sdk, policy, tool: "search.web", agentId: "agent://demo", amount });
  const check = await sdk.verifyLocal("simple_yesno", gate.proof.proof, {
    proofId: gate.proof.proof_id,
    envelope: gate.proof.envelope,
  });
  console.log(`${amount} GBP -> ${gate.allowed ? "ALLOW" : "DENY"} (${gate.reason}) proof=${gate.proof.proof_id} decision=${check.decision} envelope=${check.envelope_reason}`);
}
sdk.dispose();
