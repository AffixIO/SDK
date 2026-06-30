import type { SdkConfig } from "./types.js";
export declare function resolveConfig(partial: Partial<SdkConfig> & {
    apiKey?: string;
}): SdkConfig;
