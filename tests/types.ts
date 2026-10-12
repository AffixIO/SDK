import { AffixSDK, spendingPolicy, verifyAgentSpend } from "affixio";
import { MemoryStore, FileStore, BudgetLedger, DecisionPipeline, WorkflowSession, expressGate, fastifyGate,
  createMcpGate, createX402Fetch, createAp2Authorizer, createEvidenceBundle, verifyEvidenceBundle, instrument,
  type DecisionPolicy, type ActionProposal, type McpResult } from "affixio/workflows";
import { renderEvidenceSummary } from "affixio/browser";

const store = new FileStore("./runtime-data/state.json");
const memory = new MemoryStore();
memory.transaction(records => records.test = { enabled: true });
const ledger = new BudgetLedger({ store });
ledger.reserve({ account: "team", id: "1", binding: "digest", amount: 10, currency: "GBP", limit: 20 });
const policy: DecisionPolicy = { id: "p", version: "1", mode: "all", rules: [{ source: "ready", operator: "truthy", maxAgeMs: 1000 }] };
const pipeline = new DecisionPipeline({ sources: { ready: async (_, { signal }) => ({ value: !signal.aborted }) } });
const sdk = new AffixSDK({ apiKey: "type-check-only" });
const intent = { action: "read" };
const result = await pipeline.evaluate(policy, intent);
await pipeline.prove(sdk, policy, {}, { requestId: "request-1" });
const session = new WorkflowSession({ store, scope: "tenant", sessionId: "1", authorizeReview: ({ actor }) => actor === "owner" });
const proposal: ActionProposal = { id: "1", intent, policy, result };
session.propose(proposal);
await session.execute("1", async (_, { idempotencyKey }) => ({ id: idempotencyKey }));
const middleware = expressGate(async (request: { user: string }) => ({ decision: request.user ? "allow" : "deny" }));
const fastify = fastifyGate(async (request: { user: string }) => ({ decision: request.user ? "allow" : "deny" }));
const mcp = createMcpGate({ tools: [{ name: "read", inputSchema: {} }], canDiscover: (ctx: { user: string }) => Boolean(ctx.user),
  authorize: async () => ({ decision: "allow" }), execute: async (): Promise<McpResult> => ({ content: [{ type: "text", text: "ok" }] }) });
await mcp.list({ user: "owner" });
const payment = spendingPolicy({ maxPerDay: 20 });
await verifyAgentSpend({ sdk, policy: payment, budgetLedger: ledger, budgetAccount: "team", requestId: "typed", amount: 1 });
const bundle = createEvidenceBundle([{ name: "result", data: { yes: true } }]);
createEvidenceBundle([{ name: "decision", data: result }, { name: "workflow", data: session.get("1") }]);
createMcpGate({ tools: [{ name: "run", inputSchema: {} }], canDiscover: () => true,
  authorize: async () => result, execute: async ({ decision }) => {
    session.propose({ ...proposal, id: "typed-mcp", result: decision });
    return { content: [{ type: "text", text: "ok" }] };
  } });
const verified = await verifyEvidenceBundle(bundle, { trustedPublicKeys: [] });
renderEvidenceSummary(document.createElement("section"), verified);
await instrument()("decision", async () => result);
void [middleware, fastify, createX402Fetch, createAp2Authorizer];

// 2.0.0-beta.2 pinning types
import { verifyLocalAttestation as _vla, fetchAffixioKeys as _fak, createReplayGuard as _crg, AffixSDK as _Sdk } from "affixio";
const _sdkPinned = new _Sdk({ apiKey: "k", role: "device", trustedSigningKeys: { keys: [{ key_id: "k", public_key_b64: "AA==" }] } });
void _sdkPinned; void _vla; void _fak; void _crg;
