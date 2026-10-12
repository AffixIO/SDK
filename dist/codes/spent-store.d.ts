import { type AffixDocumentStore } from "../storage/index.js";
export declare class CodeUseStore {
    private readonly docs;
    private readonly key;
    constructor(docsOrPath?: AffixDocumentStore | string, key?: string);
    private read;
    private write;
    getUses(gateId: string, proofDigest: string): Promise<number>;
    checkAdmission(gateId: string, proofDigest: string, maxUses: number): Promise<{
        admitted: boolean;
        uses: number;
        remaining: number | null;
        reason?: string;
    }>;
    consume(gateId: string, proofDigest: string, maxUses: number): Promise<{
        admitted: boolean;
        uses: number;
        remaining: number | null;
        reason?: string;
    }>;
    reset(gateId?: string, proofDigest?: string): Promise<void>;
}
export declare function resolveSidecarPath(basePath: string, codeId: string): string;
