export declare const DEFAULT_API_BASE = "https://api.affix-io.com";
export declare const DEFAULT_HUB_URL = "https://hub.affix-io.com";
/**
 * Know Your Agent control plane.
 * Pass an AffixSDK instance (from `new AffixSDK({ apiKey })`) or use `createAgentTrust()`.
 */
export declare class AgentTrust {
    sdk: any;
    ownsSdk: any;
    apiBase: any;
    hubUrl: any;
    apiKey: any;
    receipts: any;
    policies: any;
    constructor(options?: {
        sdk: any;
        ownsSdk?: boolean;
        apiKey?: string | null;
        apiBase?: string;
        hubUrl?: string;
    });
    enrol({ agentId, holder, model, capabilities, ttlSeconds, metadata }: any): Promise<{
        kind: string;
        agent_id: any;
        holder: any;
        model: any;
        capabilities: any;
        capabilities_digest: any;
        issued_at: number;
        expires_at: number;
        metadata: {};
        circuit_id: any;
        proof_id: any;
        proof_digest: any;
        proof: any;
    }>;
    verifyCredential(credential: any): Promise<{
        valid: boolean;
        reason: string;
        agent_id?: undefined;
    } | {
        valid: boolean;
        reason: string;
        agent_id: any;
    }>;
    authorise({ credential, action, resource, args, attest }?: any): Promise<{
        agent_id: any;
        action: string;
        resource: string;
        allowed: boolean;
        decision: any;
        reason: any;
        matched_capability: any;
        proof_id: any;
        circuit_id: any;
        proof_digest: any;
        proof: any;
        attested: boolean;
        attestation: any;
        at: string;
    } | {
        allowed: boolean;
        decision: string;
        reason: string;
        action: any;
        resource: any;
        matched_capability: any;
        attested: boolean;
    }>;
    buildAuditTrail(options?: any): Promise<{
        leaf_count: number;
        merkle_root: any;
        receipts: number;
        batch_id?: undefined;
    } | {
        leaf_count: any;
        merkle_root: any;
        batch_id: any;
        receipts: any;
    }>;
    badge(credential: any, options?: any): Promise<any>;
    scanBadge(carrier: any, options?: any): Promise<any>;
    dispose(): void;
}
