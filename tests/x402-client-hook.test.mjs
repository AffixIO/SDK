import assert from "node:assert/strict";
import test from "node:test";
import { AffixSDK, paidApiAgentPolicy } from "affixio";
import { attachAffixioPrePaymentGate } from "../examples/x402-before-pay/affixio-x402-gate.mjs";

const paymentRequired = { resource: { url: "https://api.example.test/report" } };
const selectedRequirements = { payTo: "0xmerchant", amount: "1.25" };

test("x402 gate aborts a denied payment without changing x402 data", async () => {
  let hook;
  const client = { onBeforePaymentCreation: value => { hook = value; return client; } };
  const sdk = new AffixSDK({ apiKey: "aio_demo", licenceOnly: true, autoFlush: false });
  const policy = paidApiAgentPolicy({ currency: "USD", maxPerAction: 2, maxPerDay: 25 });
  attachAffixioPrePaymentGate({ client, sdk, policy, agentId: "agent://test" });
  const before = JSON.stringify({ paymentRequired, selectedRequirements });
  const result = await hook({ paymentRequired, selectedRequirements });
  assert.equal(result.abort, true);
  assert.match(result.reason, /^AffixIO denied this payment:/);
  assert.equal(JSON.stringify({ paymentRequired, selectedRequirements }), before);
});

test("x402 gate rejects incomplete setup before registering a hook", () => {
  assert.throws(() => attachAffixioPrePaymentGate({}), /x402 client/);
});
