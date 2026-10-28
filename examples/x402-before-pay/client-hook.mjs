import { x402Client } from "@x402/core/client";
import { AffixSDK, paidApiAgentPolicy } from "affixio";
import { attachAffixioPrePaymentGate } from "./affixio-x402-gate.mjs";

const sdk = new AffixSDK({
  apiKey: process.env.AFFIX_API_KEY || "aio_demo",
  licenceOnly: true,
  autoFlush: false,
});

const policy = paidApiAgentPolicy({ currency: "USD", maxPerAction: 2, maxPerDay: 25 });
const client = new x402Client();

attachAffixioPrePaymentGate({
  client,
  sdk,
  policy,
  agentId: process.env.AFFIX_AGENT_ID || "agent://demo",
});

// Register the wallet scheme client required by your network here, then pass
// `client` to the x402 transport you use. The hook runs after x402 receives
// PaymentRequired and selects an offer, but before it creates a payment payload.
console.log("AffixIO pre-payment gate attached to the x402 client.");
