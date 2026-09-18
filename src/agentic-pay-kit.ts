/* Credit: @paparichens */
import type { AffixSDK } from "./index.js";

export type AgenticPaymentDecision = {
  allowed: boolean;
  reason: string;
};

export type AgenticPaymentPolicyRules = {
  currency?: string;
  maxPerAction?: number | null;
  maxPerDay?: number | null;
  allowedMerchants?: string[];
  allowedCategories?: string[];
  requireHumanApprovalAbove?: number | null;
  expiresAt?: string | null;
  metadata?: Record<string, unknown>;
};

export type AgenticPaymentIntent = {
  agentId?: string;
  action?: string;
  resource?: string;
  merchant?: string;
  amount?: number;
  currency?: string;
  category?: string;
  rail?: string;
  humanApproved?: boolean;
  mandateId?: string;
};

export type PaymentMandate = {
  mandate_id: string;
  type: string;
  user_ref: string | null;
  agent_id: string | null;
  merchant: string | null;
  amount: number | null;
  currency: string;
  scope: unknown[];
  policy: Record<string, unknown>;
  created_at: string;
  expires_at: string | null;
  metadata: Record<string, unknown>;
};

export type VerifyAgentSpendInput = AgenticPaymentIntent & {
  sdk: AffixSDK;
  policy?: AgenticPaymentPolicy | AgenticPaymentPolicyRules;
  agent?: Record<string, unknown>;
  mandate?: PaymentMandate;
  mandate_id?: string;
  agent_id?: string;
  circuitId?: string;
  proofMode?: "hmac" | "ultrahonk";
  mode?: "auto" | "offline" | "online";
  origin?: string;
  requestId?: string;
  request_id?: string;
  queueForSync?: boolean;
  meta?: Record<string, string>;
};

export type AgentCheckoutReceipt = {
  receipt_id: string;
  created_at: string;
  decision: string;
  reason: string | null;
  agent_id: string | null;
  action: string;
  merchant: string | null;
  amount: number | null;
  currency: string;
  rail: string | null;
  proof_id: string | null;
  proof_digest: string | null;
  merkle_root: string | null;
  metadata: Record<string, unknown>;
};

export type VerifyAgentSpendResult = {
  allowed: boolean;
  reason: string;
  intent: Required<Pick<AgenticPaymentIntent, "action" | "amount" | "currency">> & Record<string, unknown>;
  proof: Awaited<ReturnType<AffixSDK["prove"]>>;
  receipt: AgentCheckoutReceipt;
};
const DEFAULT_CURRENCY = "GBP";

function nowIso() {
  return new Date().toISOString();
}

function normaliseMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error("amount must be a positive number");
  return Math.round(n * 100) / 100;
}

function slugValue(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:/-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function expiresAt(input) {
  if (!input) return null;
  if (input instanceof Date) return input.toISOString();
  if (typeof input === "number") return new Date(Date.now() + input).toISOString();
  return String(input);
}

export class AgenticPaymentPolicy {
  rules;
  constructor(rules?: AgenticPaymentPolicyRules) {
    this.rules = {
      currency: rules.currency ?? DEFAULT_CURRENCY,
      maxPerAction: rules.maxPerAction ?? null,
      maxPerDay: rules.maxPerDay ?? null,
      allowedMerchants: Array.isArray(rules.allowedMerchants) ? [...rules.allowedMerchants] : [],
      allowedCategories: Array.isArray(rules.allowedCategories) ? [...rules.allowedCategories] : [],
      requireHumanApprovalAbove: rules.requireHumanApprovalAbove ?? null,
      expiresAt: rules.expiresAt ?? null,
      metadata: { ...(rules.metadata ?? {}) },
    };
  }

  currency(value: string): this {
    this.rules.currency = String(value || DEFAULT_CURRENCY).toUpperCase();
    return this;
  }

  maxPerAction(amount: number, currency?: string): this {
    this.rules.maxPerAction = normaliseMoney(amount);
    this.rules.currency = String(currency || this.rules.currency).toUpperCase();
    return this;
  }

  maxPerDay(amount: number, currency?: string): this {
    this.rules.maxPerDay = normaliseMoney(amount);
    this.rules.currency = String(currency || this.rules.currency).toUpperCase();
    return this;
  }

  allowMerchants(merchants: string[]): this {
    this.rules.allowedMerchants = Array.from(new Set([...(this.rules.allowedMerchants || []), ...(merchants || [])].map(String)));
    return this;
  }

  allowCategories(categories: string[]): this {
    this.rules.allowedCategories = Array.from(new Set([...(this.rules.allowedCategories || []), ...(categories || [])].map(String)));
    return this;
  }

  requireApprovalAbove(amount: number): this {
    this.rules.requireHumanApprovalAbove = normaliseMoney(amount);
    return this;
  }

  expireAt(value: string | Date | number): this {
    this.rules.expiresAt = expiresAt(value);
    return this;
  }

  expireIn(ms: number): this {
    this.rules.expiresAt = expiresAt(Number(ms));
    return this;
  }

  metadata(meta: Record<string, unknown>): this {
    this.rules.metadata = { ...this.rules.metadata, ...(meta || {}) };
    return this;
  }

  toJSON(): AgenticPaymentPolicyRules {
    return { ...this.rules, metadata: { ...this.rules.metadata } };
  }

  decide(intent?: AgenticPaymentIntent): AgenticPaymentDecision {
    const amount = normaliseMoney(intent.amount ?? 0);
    const currency = String(intent.currency || this.rules.currency || DEFAULT_CURRENCY).toUpperCase();
    if (this.rules.currency && currency !== String(this.rules.currency).toUpperCase()) {
      return { allowed: false, reason: "currency_not_allowed" };
    }
    if (this.rules.maxPerAction !== null && amount > this.rules.maxPerAction) {
      return { allowed: false, reason: "amount_above_max_per_action" };
    }
    if (this.rules.requireHumanApprovalAbove !== null && amount > this.rules.requireHumanApprovalAbove && !intent.humanApproved) {
      return { allowed: false, reason: "human_approval_required" };
    }
    if (this.rules.allowedMerchants.length && intent.merchant) {
      const merchant = String(intent.merchant).toLowerCase();
      const ok = this.rules.allowedMerchants.some((m) => merchant === String(m).toLowerCase() || merchant.endsWith(`.${String(m).toLowerCase()}`));
      if (!ok) return { allowed: false, reason: "merchant_not_allowed" };
    }
    if (this.rules.allowedCategories.length && intent.category) {
      const category = String(intent.category).toLowerCase();
      if (!this.rules.allowedCategories.map((c) => String(c).toLowerCase()).includes(category)) {
        return { allowed: false, reason: "category_not_allowed" };
      }
    }
    if (this.rules.expiresAt && Date.parse(this.rules.expiresAt) <= Date.now()) {
      return { allowed: false, reason: "mandate_expired" };
    }
    return { allowed: true, reason: "allowed" };
  }
}

export function spendingPolicy(rules?: AgenticPaymentPolicyRules): AgenticPaymentPolicy {
  return new AgenticPaymentPolicy(rules);
}

export function shoppingAgentPolicy(options?: { currency?: string; maxPerAction?: number; maxPerDay?: number; categories?: string[]; metadata?: Record<string, unknown> }): AgenticPaymentPolicy {
  return spendingPolicy()
    .currency(options.currency || DEFAULT_CURRENCY)
    .maxPerAction(options.maxPerAction ?? 100, options.currency || DEFAULT_CURRENCY)
    .maxPerDay(options.maxPerDay ?? 500, options.currency || DEFAULT_CURRENCY)
    .allowCategories(options.categories || ["retail", "travel", "software"])
    .metadata({ preset: "shopping-agent", ...(options.metadata || {}) });
}

export function paidApiAgentPolicy(options?: { currency?: string; maxPerAction?: number; maxPerDay?: number; categories?: string[]; metadata?: Record<string, unknown> }): AgenticPaymentPolicy {
  return spendingPolicy()
    .currency(options.currency || "USD")
    .maxPerAction(options.maxPerAction ?? 5, options.currency || "USD")
    .maxPerDay(options.maxPerDay ?? 100, options.currency || "USD")
    .allowCategories(options.categories || ["api", "data", "compute"])
    .metadata({ preset: "paid-api-agent", ...(options.metadata || {}) });
}

export function createPaymentMandate(input: any = {}): PaymentMandate {
  const policy = input.policy?.toJSON ? input.policy.toJSON() : input.policy || {};
  const mandate = {
    mandate_id: input.mandateId || `mandate_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    type: input.type || "open",
    user_ref: input.userRef || input.user_ref || null,
    agent_id: input.agentId || input.agent_id || null,
    merchant: input.merchant || null,
    amount: input.amount === undefined ? null : normaliseMoney(input.amount),
    currency: String(input.currency || policy.currency || DEFAULT_CURRENCY).toUpperCase(),
    scope: input.scope || [],
    policy,
    created_at: nowIso(),
    expires_at: expiresAt(input.expiresAt || input.expires_at || policy.expiresAt) || null,
    metadata: { ...(input.metadata || {}) },
  };
  return mandate;
}

export function createAgentCheckoutReceipt(input: any = {}): AgentCheckoutReceipt {
  const proof = input.proof || {};
  return {
    receipt_id: input.receiptId || `agent_receipt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    created_at: nowIso(),
    decision: input.decision || proof.decision || "no",
    reason: input.reason || null,
    agent_id: input.agentId || input.agent_id || input.intent?.agentId || null,
    action: input.action || input.intent?.action || "checkout.pay",
    merchant: input.merchant || input.intent?.merchant || null,
    amount: input.amount ?? input.intent?.amount ?? null,
    currency: input.currency || input.intent?.currency || DEFAULT_CURRENCY,
    rail: input.rail || input.intent?.rail || null,
    proof_id: proof.proof_id || input.proofId || null,
    proof_digest: proof.proof_digest || input.proofDigest || null,
    merkle_root: proof.merkle_root || input.merkleRoot || null,
    metadata: { ...(input.metadata || {}) },
  };
}

export async function verifyAgentSpend(input: VerifyAgentSpendInput): Promise<VerifyAgentSpendResult> {
  if (!input.sdk || typeof input.sdk.prove !== "function") throw new Error("verifyAgentSpend requires sdk");
  const rawPolicy: any = input.policy;
  const policy: AgenticPaymentPolicy = rawPolicy?.decide ? rawPolicy : spendingPolicy(rawPolicy || {});
  const intent = {
    agentId: input.agentId || input.agent_id || input.agent?.agentId || input.agent?.id || "agent://unknown",
    action: input.action || "checkout.pay",
    resource: input.resource || input.merchant || "merchant://unknown",
    merchant: input.merchant || null,
    amount: normaliseMoney(input.amount ?? 0),
    currency: String(input.currency || policy.rules?.currency || DEFAULT_CURRENCY).toUpperCase(),
    category: input.category || null,
    rail: input.rail || null,
    humanApproved: Boolean(input.humanApproved),
    mandateId: input.mandate?.mandate_id || input.mandateId || null,
  };
    const decision = policy.decide(intent as AgenticPaymentIntent);
  const proof = await input.sdk.prove({
    circuitId: input.circuitId || "simple_yesno",
    proofMode: input.proofMode || "hmac",
    mode: input.mode || "offline",
    decision: decision.allowed ? "yes" : "no",
    origin: input.origin || "agentic_pay",
    request_id: input.requestId || input.request_id || `agentic_${slugValue(intent.agentId)}_${Date.now()}`,
    fields: {
      claim: decision.allowed ? "approved" : "denied",
      required: "approved",
      amount: intent.amount,
      currency: intent.currency,
      action: intent.action,
    },
    meta: {
      agent_id: String(intent.agentId),
      action: String(intent.action),
      resource: String(intent.resource),
      merchant: String(intent.merchant || ""),
      amount: String(intent.amount),
      currency: String(intent.currency),
      rail: String(intent.rail || ""),
      mandate_id: String(intent.mandateId || ""),
      policy_reason: decision.reason,
      ...(input.meta || {}),
    },
    queueForSync: input.queueForSync,
  });
  return {
    allowed: decision.allowed,
    reason: decision.reason,
    intent,
    proof,
    receipt: createAgentCheckoutReceipt({ intent, proof, decision: decision.allowed ? "yes" : "no", reason: decision.reason }),
  };
}

export async function agenticPay(input: VerifyAgentSpendInput): Promise<VerifyAgentSpendResult> {
  return verifyAgentSpend({ ...input, action: input.action || "checkout.pay", origin: input.origin || "agentic_pay" });
}

export async function x402BeforePay(input: VerifyAgentSpendInput): Promise<VerifyAgentSpendResult> {
  return verifyAgentSpend({ ...input, action: input.action || "http.402.pay", rail: input.rail || "x402", origin: input.origin || "x402_before_pay" });
}

export async function mcpToolGate(input: VerifyAgentSpendInput & { tool?: string }): Promise<VerifyAgentSpendResult> {
  return verifyAgentSpend({ ...input, action: input.action || `mcp.${input.tool || "tool"}`, resource: input.resource || `mcp://tool/${input.tool || "unknown"}`, origin: input.origin || "mcp_tool_gate" });
}

export function createAgenticPayKit(sdkOrOptions: AffixSDK | { sdk: AffixSDK; policy?: AgenticPaymentPolicy; policyRules?: AgenticPaymentPolicyRules } = {} as any, maybeOptions: { policy?: AgenticPaymentPolicy; policyRules?: AgenticPaymentPolicyRules } = {}) {
  const options = sdkOrOptions && typeof (sdkOrOptions as AffixSDK).prove === "function" ? { ...maybeOptions, sdk: sdkOrOptions as AffixSDK } : (sdkOrOptions as any) || {};
  const sdk = options.sdk;
  const defaultPolicy = options.policy || spendingPolicy(options.policyRules || {});
  return {
    policy: defaultPolicy,
    createPaymentMandate,
    createAgentCheckoutReceipt,
    spendingPolicy,
    shoppingAgentPolicy,
    paidApiAgentPolicy,
    verifyAgentSpend: (input) => verifyAgentSpend({ sdk, policy: defaultPolicy, ...input }),
    agenticPay: (input) => agenticPay({ sdk, policy: defaultPolicy, ...input }),
    x402BeforePay: (input) => x402BeforePay({ sdk, policy: defaultPolicy, ...input }),
    mcpToolGate: (input) => mcpToolGate({ sdk, policy: defaultPolicy, ...input }),
  };
}
