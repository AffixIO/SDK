// Shared gate used by every example in examples/gate/.
// Runs fully offline: licenceOnly mode, no API calls, HMAC proof + ML-DSA-65 envelope.
import { AffixSDK, mcpToolGate, spendingPolicy } from "affixio";

export const sdk = new AffixSDK({
  apiKey: process.env.AFFIX_API_KEY ?? "aio_demo",
  licenceOnly: true,
  autoFlush: false,
});

export const policy = spendingPolicy()
  .currency("GBP")
  .maxPerAction(10)
  .allowCategories(["search", "data"]);

// Returns the gate result. Callers must not run the tool unless gate.allowed is true.
export async function gateToolCall({ tool, agentId = "agent://demo", amount = 0, category = "search" }) {
  return mcpToolGate({ sdk, policy, tool, agentId, amount, currency: "GBP", category });
}
