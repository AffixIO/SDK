export declare class CapabilityPolicy {
    grants: any;
    counters: any;
    constructor(capabilities?: any[]);
    digest(): string;
    list(): any;
    decide({ action, resource }?: {
        action?: string;
        resource?: string;
    }): {
        allow: boolean;
        reason: string;
        matched: any;
    };
    reset(): void;
}
