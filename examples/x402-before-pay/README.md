# AffixIO gate for an x402 client

This example attaches an AffixIO policy decision to x402's
`onBeforePaymentCreation` lifecycle hook. It runs after x402 has received a
`PaymentRequired` response and selected an offer, but before x402 creates a
payment payload or signs anything.

It is deliberately not an x402 protocol extension. It does not add data to
`PaymentRequired.extensions` or `PaymentPayload.extensions`, and it does not
alter settlement. x402 remains responsible for payment selection, signing and
transport. AffixIO only returns an allow or deny decision for the intended
payment.

```bash
npm install affixio @x402/core
node client-hook.mjs
```

Register the relevant x402 scheme client before sending a paid request. When a
payment is about to be created, a denied decision returns x402's documented
`{ abort: true, reason }` hook result. No payment payload is created.

The hook's decision receipt can be retained by the calling application for its
own audit trail. It is not added to x402 protocol messages.
