import { canonical, clone, required } from "./canonical.js";
import { digest } from "./budget.js";

function decodeHeader(value) {
  if (!value || value.length > 65536) throw new Error("Missing or oversized payment header");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error("Invalid payment header encoding");
  return JSON.parse(Buffer.from(value, "base64").toString("utf8"));
}

export function createX402Fetch({ fetch: transport = globalThis.fetch, authorize, sign, verifySettlement, allowedOrigins }) {
  if (![authorize, sign, verifySettlement].every(fn => typeof fn === "function") || !Array.isArray(allowedOrigins) || !allowedOrigins.length) throw new TypeError("x402 requires authorization, signer, settlement verifier and origins");
  return async (url, { signal, headers = {} } = {}) => {
    const target = new URL(url);
    if (target.protocol !== "https:" || target.username || target.password || target.hash || !allowedOrigins.includes(target.origin)) throw new Error("Payment origin is not allowed");
    const initialHeaders = new Headers(headers);
    if (initialHeaders.has("PAYMENT-SIGNATURE")) throw new Error("Payment headers must come from the authorized signer");
    const options = { method: "GET", redirect: "error", credentials: "omit", signal, headers: initialHeaders };
    const initial = await transport(target.href, options);
    if (initial.status !== 402) return { response: initial, paid: false, settlement: null };
    const requiredPayment = decodeHeader(initial.headers.get("PAYMENT-REQUIRED"));
    await initial.body?.cancel();
    if (requiredPayment.x402Version !== 2 || requiredPayment.resource?.url !== target.href || !Array.isArray(requiredPayment.accepts) || !requiredPayment.accepts.length) throw new Error("Unsupported or unbound x402 challenge");
    for (const choice of requiredPayment.accepts) {
      if (typeof choice.amount !== "string" || !/^\d+$/.test(choice.amount)) throw new Error("Invalid atomic-unit amount");
      for (const key of ["scheme", "network", "asset", "payTo"]) required(choice[key], key);
      if (!Number.isSafeInteger(choice.maxTimeoutSeconds) || choice.maxTimeoutSeconds <= 0) throw new Error("Invalid payment timeout");
    }
    const decision = await authorize(clone(requiredPayment));
    if (decision?.decision !== "allow") throw new Error("Payment not authorized");
    const selected = requiredPayment.accepts.find(choice => canonical(choice) === canonical(decision.accepted));
    if (!selected) throw new Error("Authorized requirement is not in the challenge");
    const payment = await sign({ x402Version: 2, resource: clone(requiredPayment.resource), accepted: clone(selected) });
    if (payment?.x402Version !== 2 || canonical(payment.resource) !== canonical(requiredPayment.resource) || canonical(payment.accepted) !== canonical(selected) || !payment.payload) throw new Error("Signer returned an unbound payment");
    const paidHeaders = new Headers(initialHeaders);
    paidHeaders.set("PAYMENT-SIGNATURE", Buffer.from(canonical(payment)).toString("base64"));
    const response = await transport(target.href, { ...options, headers: paidHeaders });
    const settlement = decodeHeader(response.headers.get("PAYMENT-RESPONSE"));
    if (await verifySettlement({ settlement: clone(settlement), payment: clone(payment), status: response.status }) !== true) {
      await response.body?.cancel();
      throw new Error("Settlement not verified; reconcile before retrying");
    }
    return { response, paid: true, settlement };
  };
}

export function createAp2Authorizer({ verifyMandate, store, scope, clock = Date.now }) {
  required(scope, "AP2 scope");
  if (typeof verifyMandate !== "function") throw new TypeError("Trusted AP2 verifier required");
  return async ({ signedMandate, expected }) => {
    const result = await verifyMandate(signedMandate);
    if (result?.verified !== true) throw new Error("Mandate signature not verified");
    const mandate = clone(result.claims);
    for (const key of ["mandateId", "principal", "agent", "merchant", "currency", "checkoutDigest"]) required(mandate[key], key);
    for (const key of ["principal", "agent", "merchant", "currency", "checkoutDigest"]) {
      if (mandate[key] !== expected[key]) throw new Error(`Mandate ${key} mismatch`);
    }
    if (!Number.isSafeInteger(mandate.expiresAt) || mandate.expiresAt <= clock()) throw new Error("Mandate expired");
    if (!Number.isSafeInteger(mandate.amountMinor) || mandate.amountMinor < 0 || mandate.amountMinor !== expected.amountMinor) throw new Error("Mandate amount mismatch");
    required(expected.requestId, "payment request id");
    return store.transaction(records => {
      const key = `ap2:${digest([scope, mandate.mandateId])}`;
      if (records[key]) throw new Error("Mandate already consumed; reconcile the existing request");
      const receipt = { schema: "affix.ap2.authorization.v1", mandateDigest: digest(mandate), requestId: expected.requestId, authorizedAt: clock(), expiresAt: mandate.expiresAt };
      records[key] = receipt;
      return receipt;
    });
  };
}
