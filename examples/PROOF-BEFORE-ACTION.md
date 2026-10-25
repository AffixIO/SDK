# Proof before action

This example shows the minimum host-side control needed for an authorised tool call:

1. Build the exact intent and policy.
2. Evaluate the gate.
3. Verify the returned proof and pinned ML-DSA-65 envelope.
4. Check replay state.
5. Execute the tool only inside the final allow branch.

Run it from the repository root after installing dependencies:

```bash
npm ci
node examples/proof-before-action.mjs
```

The low-value request executes. The request above the per-action limit is denied before the synthetic tool result is produced. The example runs in `licenceOnly` mode and does not require an API key or network access.

This is a demonstration of a host control boundary, not a claim that the SDK can determine whether an external data source is truthful. Production integrations must also bind the resource, policy revision, session or agent identifier, and any approval or delegation context into the action input.
