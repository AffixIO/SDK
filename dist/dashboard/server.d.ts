import { AffixSDK } from "../index.js";
/**
 * Start the local AffixIO ops dashboard (KYA + live operator data).
 * Binds to 127.0.0.1 by default for self-hosted ops.
 */
export declare function runDashboard(options?: {
    host?: string;
    port?: number | string;
    apiKey?: string;
    apiBase?: string;
    operatorBaseDir?: string;
    kyaStorageDir?: string;
    sdk?: AffixSDK;
}): Promise<{
    server: import("node:http").Server;
    url: string;
    host: string;
    port: number;
    shutdown: () => void;
    sdk: AffixSDK;
    trust: unknown;
}>;
export default runDashboard;
