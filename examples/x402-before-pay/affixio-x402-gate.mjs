import { x402BeforePay } from "affixio";

/**
 * Add an AffixIO decision before x402 creates a payment payload.
 *
 * This is a client hook, not an x402 protocol extension. It does not add,
 * change, or rely on data in `PaymentRequired.extensions` or
 * `PaymentPayload.extensions`.
 */
export function attachAffixioPrePaymentGate({ client, sdk, policy, agentId, category = "payment" }) {
  if (!client || typeof client.onBeforePaymentCreation !== "function") {
    throw new TypeError("An x402 client with onBeforePaymentCreation is required");
  }
  if (!sdk || !policy || !agentId) {
    throw new TypeError("sdk, policy, and agentId are required");
  }

  client.onBeforePaymentCreation(async ({ paymentRequired, selectedRequirements }) => {
    const decision = await x402BeforePay({
      sdk,
      policy,
      agentId,
      resource: paymentRequired.resource?.url || "x402:unknown-resource",
      merchant: selectedRequirements.payTo,
      amount: Number(selectedRequirements.amount),
      currency: "USD",
      category,
    });

    if (!decision.allowed) {
      return { abort: true, reason: `AffixIO denied this payment: ${decision.reason}` };
    }
  });

  return client;
}
