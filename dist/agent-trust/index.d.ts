/* AffixIO Know Your Agent types. Credit: @paparichens */
export declare class CapabilityPolicy {
  constructor(capabilities?: Array<{ action: string; resource?: string; maxPerRun?: number | null }>);
  digest(): string;
  list(): Array<{ action: string; resource: string; maxPerRun: number | null }>;
  decide(input?: { action?: string; resource?: string }): {
    allow: boolean;
    reason: string;
    matched: { action: string; resource: string; maxPerRun: number | null } | null;
  };
  reset(): void;
}
export declare const KYA_CIRCUIT: "simple_yesno";
export declare const ENROLLED_CLAIM: "enrolled";
export declare const DEFAULT_API_BASE: "https://api.affix-io.com";
export declare const DEFAULT_HUB_URL: "https://hub.affix-io.com";
export declare function identityBinding(agentId: string, capabilitiesDigest: string): string;
export declare function issueAgentCredential(sdk: unknown, input: Record<string, unknown>): Promise<Record<string, unknown>>;
export declare function verifyAgentCredential(credential: unknown, sdk: unknown): Promise<{ valid: boolean; reason: string; agent_id?: string }>;
export declare class AgentTrust {
  constructor(options: { sdk: unknown; ownsSdk?: boolean; apiKey?: string | null; apiBase?: string; hubUrl?: string });
  readonly apiBase: string;
  readonly hubUrl: string;
  enrol(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  verifyCredential(credential: unknown): Promise<{ valid: boolean; reason: string; agent_id?: string }>;
  authorise(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  buildAuditTrail(options?: { receipts?: unknown[] }): Promise<Record<string, unknown>>;
  badge(credential: unknown, options?: Record<string, unknown>): Promise<unknown>;
  scanBadge(carrier: unknown, options?: Record<string, unknown>): Promise<unknown>;
  dispose(): void;
}
