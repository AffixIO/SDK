import { AffixSDK, mcpToolGate, spendingPolicy } from "affixio";

const sdk = new AffixSDK({
  apiKey: process.env.AFFIX_API_KEY || "aio_demo",
  licenceOnly: true,
  autoFlush: false,
});

const policy = spendingPolicy()
  .currency("GBP")
  .maxPerAction(10)
  .allowCategories(["api", "data"]);

async function callPaidTool(input) {
  const gate = await mcpToolGate({
    sdk,
    policy,
    tool: "paid.market.report",
    agentId: input.agentId,
    amount: input.amount,
    currency: "GBP",
    category: "data",
  });

  if (!gate.allowed) {
    return { ok: false, reason: gate.reason, receipt: gate.receipt };
  }

  return {
    ok: true,
    data: { market: "agentic commerce", trend: "proof before spend" },
    receipt: gate.receipt,
  };
}

console.log(await callPaidTool({
  agentId: "agent://research-runner/demo",
  amount: 4.5,
}));

sdk.dispose();
