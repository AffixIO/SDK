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
export declare class AgenticPaymentPolicy {
    rules: any;
    constructor(rules?: AgenticPaymentPolicyRules);
    currency(value: string): this;
    maxPerAction(amount: number, currency?: string): this;
    maxPerDay(amount: number, currency?: string): this;
    allowMerchants(merchants: string[]): this;
    allowCategories(categories: string[]): this;
    requireApprovalAbove(amount: number): this;
    expireAt(value: string | Date | number): this;
    expireIn(ms: number): this;
    metadata(meta: Record<string, unknown>): this;
    toJSON(): AgenticPaymentPolicyRules;
    decide(intent?: AgenticPaymentIntent): AgenticPaymentDecision;
}
export declare function spendingPolicy(rules?: AgenticPaymentPolicyRules): AgenticPaymentPolicy;
export declare function shoppingAgentPolicy(options?: {
    currency?: string;
    maxPerAction?: number;
    maxPerDay?: number;
    categories?: string[];
    metadata?: Record<string, unknown>;
}): AgenticPaymentPolicy;
export declare function paidApiAgentPolicy(options?: {
    currency?: string;
    maxPerAction?: number;
    maxPerDay?: number;
    categories?: string[];
    metadata?: Record<string, unknown>;
}): AgenticPaymentPolicy;
export declare function createPaymentMandate(input?: any): PaymentMandate;
export declare function createAgentCheckoutReceipt(input?: any): AgentCheckoutReceipt;
export declare function verifyAgentSpend(input: VerifyAgentSpendInput): Promise<VerifyAgentSpendResult>;
export declare function agenticPay(input: VerifyAgentSpendInput): Promise<VerifyAgentSpendResult>;
export declare function x402BeforePay(input: VerifyAgentSpendInput): Promise<VerifyAgentSpendResult>;
export declare function mcpToolGate(input: VerifyAgentSpendInput & {
    tool?: string;
}): Promise<VerifyAgentSpendResult>;
export declare function createAgenticPayKit(sdkOrOptions?: AffixSDK | {
    sdk: AffixSDK;
    policy?: AgenticPaymentPolicy;
    policyRules?: AgenticPaymentPolicyRules;
}, maybeOptions?: {
    policy?: AgenticPaymentPolicy;
    policyRules?: AgenticPaymentPolicyRules;
}): {
    policy: any;
    createPaymentMandate: typeof createPaymentMandate;
    createAgentCheckoutReceipt: typeof createAgentCheckoutReceipt;
    spendingPolicy: typeof spendingPolicy;
    shoppingAgentPolicy: typeof shoppingAgentPolicy;
    paidApiAgentPolicy: typeof paidApiAgentPolicy;
    verifyAgentSpend: (input: any) => Promise<VerifyAgentSpendResult>;
    agenticPay: (input: any) => Promise<VerifyAgentSpendResult>;
    x402BeforePay: (input: any) => Promise<VerifyAgentSpendResult>;
    mcpToolGate: (input: any) => Promise<VerifyAgentSpendResult>;
};
