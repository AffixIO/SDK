import { AffixSDK, agenticPay, shoppingAgentPolicy } from "affixio";

const sdk = new AffixSDK({
  apiKey: process.env.AFFIX_API_KEY || "aio_demo",
  licenceOnly: true,
  autoFlush: false,
});

const policy = shoppingAgentPolicy({
  currency: "GBP",
  maxPerAction: 50,
  maxPerDay: 250,
  categories: ["retail", "software"],
});

const result = await agenticPay({
  sdk,
  policy,
  agentId: "agent://personal-shopper/demo",
  merchant: "example.com",
  amount: 39.99,
  currency: "GBP",
  category: "retail",
  rail: "checkout",
  meta: {
    demo: "agentic-pay",
  },
});

console.log(JSON.stringify({
  allowed: result.allowed,
  reason: result.reason,
  receipt: result.receipt,
}, null, 2));

sdk.dispose();
