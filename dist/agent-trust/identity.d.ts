export declare const KYA_CIRCUIT = "simple_yesno";
export declare const ENROLLED_CLAIM = "enrolled";
export declare function identityBinding(agentId: any, capabilitiesDigest: any): string;
export declare function issueAgentCredential(sdk: any, { agentId, holder, model, capabilities, ttlSeconds, metadata, }: {
    agentId: any;
    holder: any;
    model: any;
    capabilities: any;
    ttlSeconds?: number;
    metadata?: {};
}): Promise<{
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
export declare function verifyAgentCredential(credential: any, sdk: any): Promise<{
    valid: boolean;
    reason: string;
    agent_id?: undefined;
} | {
    valid: boolean;
    reason: string;
    agent_id: any;
}>;
