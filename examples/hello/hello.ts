import { AffixSDK, mcpToolGate, spendingPolicy } from "affixio";
import type { AgenticPaymentPolicy } from "affixio";

// Result type of the gate. Fields: allowed, reason, intent, proof, receipt.
type GateResult = Awaited<ReturnType<typeof mcpToolGate>>;

const sdk = new AffixSDK({ apiKey: process.env.AFFIX_API_KEY ?? "aio_demo", licenceOnly: true, autoFlush: false });
const policy: AgenticPaymentPolicy = spendingPolicy().currency("GBP").maxPerAction(10);

const gate: GateResult = await mcpToolGate({ sdk, policy, tool: "search.web", agentId: "agent://demo", amount: 4.5 });
console.log(gate.allowed, gate.reason, gate.receipt.proof_id);
sdk.dispose();
