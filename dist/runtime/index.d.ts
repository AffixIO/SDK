import type { Json, EvidenceBundle, EvidenceVerification } from "./browser.js";
export type { Json, EvidenceBundle, EvidenceVerification, LocalAttestation, TrustOptions } from "./browser.js";
export { verifyEvidenceBundle, verifyPublicEnvelope } from "./browser.js";

export interface Store {
  transaction<T extends Json | void>(update: (records: Record<string, Json>) => T): T extends void ? null : T;
}
export declare class MemoryStore implements Store {
  transaction<T extends Json | void>(update: (records: Record<string, Json>) => T): T extends void ? null : T;
}
export declare class FileStore implements Store {
  constructor(path: string, options?: { lockTimeoutMs?: number });
  readonly path: string;
  transaction<T extends Json | void>(update: (records: Record<string, Json>) => T): T extends void ? null : T;
}
export interface ReservationInput {
  account: string; id: string; binding: string; amount: number; currency: string; limit: number; ttlMs?: number; reuseExisting?: boolean;
}
export interface Reservation {
  account: string; id: string; binding: string; currency: string; amountMinor: number; limitMinor: number;
  inputDigest: string; day: string; status: "held" | "executing" | "committed" | "released" | "expired";
  createdAt: number; expiresAt: number; updatedAt?: number; evidence?: string;
}
export declare class BudgetLedger {
  constructor(options: { store: Store; clock?: () => number });
  get(account: string, id: string): Reservation | null;
  reserve(input: ReservationInput): Reservation;
  start(account: string, id: string): Reservation;
  commit(account: string, id: string): Reservation;
  release(account: string, id: string): Reservation;
  reconcile(account: string, id: string, input: { outcome: "committed" | "not-executed"; evidence: string }): Reservation;
  summary(account: string, currency: string): { account: string; currency: string; day: string; committedMinor: number; reservedMinor: number; usedMinor: number };
}
export declare function minorUnits(amount: number, currency: string): number;
export declare function digest(value: unknown): string;

export interface Rule { source: string; operator: "eq" | "gte" | "lte" | "includes" | "truthy"; value?: Json; maxAgeMs: number }
export interface DecisionPolicy { id: string; version: string; mode: "all" | "any"; rules: Rule[]; requireReview?: boolean }
export type Decision = "allow" | "deny" | "review";
export interface Observation { source: string; status: "ok" | "error"; value?: Json; fingerprint?: string; observedAt: number; expiresAt?: number }
export interface DecisionResult {
  schema: "affix.decision.v1"; decision: Decision; policyId: string; policyVersion: string; policyDigest: string;
  inputDigest: string | null;
  evaluatedAt: number; validUntil: number;
  checks: { source: string; outcome: "pass" | "fail" | "review"; reason: string; fingerprint: string | null; observedAt: number | null; validUntil: number }[];
}
export type Source = (input: Json, options: { signal: AbortSignal }) => Promise<{ value: Json; observedAt?: number; expiresAt?: number }>;
export declare function dataCheckSource<Q>(adapter: { lookup(query: Q): Promise<{ pass: boolean } | null> }, queryFor: (input: Json) => Q, options?: { clock?: () => number }): Source;
export declare function validatePolicy(policy: DecisionPolicy): DecisionPolicy;
export declare function evaluatePolicy(policy: DecisionPolicy, observations: Observation[], options?: { now?: number; input?: Json }): DecisionResult;
export interface DecisionBinding { schema: "affix.decision-binding.v1"; policy: DecisionPolicy; input_digest: string; decision_digest: string }
export interface Prover<P = Json> { prove(input: {
  circuitId: string; proofMode: "hmac"; mode: "offline"; decision: "yes" | "no"; policy: DecisionBinding;
  request_id: string; fields: { claim: Decision; required: "allow" }; meta: { decision_digest: string; policy_digest: string; input_digest: string };
}): Promise<P> }
export declare class DecisionPipeline {
  constructor(options: { sources: Record<string, Source>; clock?: () => number; timeoutMs?: number });
  collect(policy: DecisionPolicy, input: Json, options?: { signal?: AbortSignal }): Promise<Observation[]>;
  evaluate(policy: DecisionPolicy, input: Json, options?: { signal?: AbortSignal }): Promise<DecisionResult>;
  prove<P>(sdk: Prover<P>, policy: DecisionPolicy, input: Json, options: { requestId: string; signal?: AbortSignal }): Promise<{ result: DecisionResult; proof: P | null; binding: DecisionBinding }>;
}
export interface ReplayCase { id: string; observations: Observation[]; at: number; input?: Json; previous?: Decision }
export declare function replayPolicy(policy: DecisionPolicy, cases: ReplayCase[]): { id: string; result: DecisionResult; previous: Decision | null }[];
export declare function watchSources(pipeline: DecisionPipeline, policy: DecisionPolicy, input: Json, options?: { intervalMs?: number; signal?: AbortSignal }): AsyncGenerator<{ result: DecisionResult; changed: boolean }>;

export interface ActionProposal {
  id: string; intent: { [key: string]: Json }; policy: DecisionPolicy; result: DecisionResult;
  budget?: { account: string; amount: number; currency: string; limit: number }; parentId?: string | null; ttlMs?: number;
}
export interface LineageEvent { sequence: number; type: string; at: number; details: Json; previous: string | null; hash: string }
export interface ActionRecord extends Omit<ActionProposal, "budget"> {
  scope: string; sessionId: string; binding: string; budget: ActionProposal["budget"] | null;
  state: "ready" | "denied" | "review" | "executing" | "completed" | "unknown" | "cancelled";
  createdAt: number; updatedAt: number; expiresAt: number; events: LineageEvent[];
  executionToken?: string; resultDigest?: string; reservation?: { account: string; id: string };
}
export interface Handover {
  receipt: { schema: "affix.handover.v1"; taskId: string; from: string; to: string; actionId: string; binding: string;
    scope: string; sessionId: string; resultDigest: string | null; lineageHead: string; createdAt: number }; digest: string;
}
export declare class WorkflowSession {
  constructor(options: {
    store: Store; scope: string; sessionId: string; clock?: () => number;
    authorizeReview?: (input: { actor: string; decision: "approve" | "deny"; action: ActionRecord }) => boolean | Promise<boolean>;
    authorizeReconciliation?: (input: { actor: string; outcome: "completed" | "not-executed"; evidence: string; action: ActionRecord }) => boolean | Promise<boolean>;
  });
  propose(input: ActionProposal): ActionRecord;
  get(id: string): ActionRecord | null;
  list(options?: { page?: number; pageSize?: number }): { page: number; pageSize: number; total: number; items: ActionRecord[] };
  review(id: string, input: { actor: string; decision: "approve" | "deny"; note?: string }): Promise<ActionRecord>;
  execute<T extends Json | void>(id: string, operation: (intent: { [key: string]: Json }, context: { idempotencyKey: string; signalDeadline: number }) => Promise<T>): Promise<{ record: ActionRecord; value: T }>;
  reconcile(id: string, input: { actor: string; outcome: "completed" | "not-executed"; evidence: string }): Promise<ActionRecord>;
  cancel(id: string): ActionRecord;
  handover(id: string, input: { taskId: string; from: string; to: string }): Handover;
}
export declare function verifyLineage(events: LineageEvent[]): boolean;

export interface SigningOptions { hmacSecret: string; secretKeyB64: string; publicKeyB64: string }
export declare function createEvidenceBundle(artifacts: { name: string; data: unknown }[], options?: { signing?: SigningOptions; createdAt?: string }): EvidenceBundle;
export declare function describeEvidence(proof: { proof_mode?: string; proofMode?: string; envelope?: { attestation?: unknown }; attestation?: unknown }): {
  proofMode: string; hasEnvelope: boolean; hasRemoteAttestation: boolean; cryptographicallyVerified: false; statement: string;
};
export declare function evidenceReport(bundle: EvidenceBundle, result: EvidenceVerification): string;

export interface GateResult { decision: Decision }
export declare function expressGate<R extends object>(authorize: (request: R) => Promise<GateResult>): (
  request: R & { affixDecision?: GateResult }, response: { status(code: number): { json(body: GateResult): unknown } }, next: (error?: unknown) => unknown
) => Promise<unknown>;
export declare function fastifyGate<R extends object>(authorize: (request: R) => Promise<GateResult>): (
  request: R & { affixDecision?: GateResult }, reply: { code(code: number): { send(body: GateResult): unknown } }
) => Promise<unknown>;
export interface McpTool { name: string; description?: string; inputSchema: { [key: string]: Json } }
export interface McpResult { isError?: boolean; content: { type: string; text?: string; [key: string]: Json | undefined }[] }
export declare function createMcpGate<C, D extends GateResult = GateResult>(options: {
  tools: McpTool[]; canDiscover: (context: C, tool: McpTool) => boolean | Promise<boolean>;
  authorize: (input: { name: string; arguments: Json; context: C }) => Promise<D>;
  execute: (input: { name: string; arguments: Json; context: C; decision: D }) => Promise<McpResult>;
}): { list(context: C): Promise<{ tools: McpTool[] }>; call(name: string, args: Json, context: C): Promise<McpResult> };
export declare function guardedAction<T extends Json | void>(session: WorkflowSession, proposal: ActionProposal,
  operation: (intent: { [key: string]: Json }, context: { idempotencyKey: string; signalDeadline: number }) => Promise<T>
): Promise<{ record: ActionRecord; value: T | null }>;
export declare function createMcpConnection(options: { command: string; args?: string[]; apiKeyEnv?: string }): { transport: "stdio"; command: string; args: string[]; requiredEnvironment: string[] };
export declare function a2aEvidencePart(handover: Handover): { kind: "data"; data: Handover; metadata: { "affixio/evidence": "handover.v1" } };

export interface PaymentRequirement { scheme: string; network: string; amount: string; asset: string; payTo: string; maxTimeoutSeconds: number; extra?: Json }
export interface PaymentResource { url: string; description?: string; mimeType?: string }
export interface PaymentChallenge { x402Version: 2; resource: PaymentResource; accepts: PaymentRequirement[] }
export interface PaymentPayload { x402Version: 2; resource: PaymentResource; accepted: PaymentRequirement; payload: Json }
export declare function createX402Fetch(options: {
  fetch?: typeof fetch; allowedOrigins: string[];
  authorize: (challenge: PaymentChallenge) => Promise<{ decision: Decision; accepted?: PaymentRequirement }>;
  sign: (request: Omit<PaymentPayload, "payload">) => Promise<PaymentPayload>;
  verifySettlement: (input: { settlement: Json; payment: PaymentPayload; status: number }) => Promise<boolean>;
}): (url: string, options?: { signal?: AbortSignal; headers?: HeadersInit }) => Promise<{ response: Response; paid: boolean; settlement: Json }>;
export interface Ap2Claims { mandateId: string; principal: string; agent: string; merchant: string; currency: string; checkoutDigest: string; amountMinor: number; expiresAt: number }
export declare function createAp2Authorizer(options: {
  verifyMandate: (signedMandate: Json) => Promise<{ verified: boolean; claims: Ap2Claims }>; store: Store; scope: string; clock?: () => number;
}): (input: { signedMandate: Json; expected: Omit<Ap2Claims, "mandateId" | "expiresAt"> & { requestId: string } }) => Promise<{
  schema: "affix.ap2.authorization.v1"; mandateDigest: string; requestId: string; authorizedAt: number; expiresAt: number;
}>;
export interface Span { setAttribute(name: string, value: string): unknown; setStatus(status: { code: number }): unknown; end(): unknown }
export declare function instrument(options?: {
  tracer?: { startSpan(name: string): Span };
  meter?: {
    createCounter(name: string): { add(value: number, attributes: Record<string, string>): unknown };
    createHistogram(name: string, options: { unit: string }): { record(value: number, attributes: Record<string, string>): unknown };
  };
  onInstrumentationError?: (error: unknown) => void;
}): <T>(operation: "decision" | "proof" | "verify" | "action" | "source" | "review", work: () => Promise<T>) => Promise<T>;
export { createReplayGuard, MemoryReplayStore } from "../replay-guard.js";
export type { ReplayGuard, ReplayStore, ReplayCheckResult } from "../replay-guard.js";
