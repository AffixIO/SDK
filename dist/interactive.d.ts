import type { AffixSDK } from "./index.js";

export type InteractiveOptions = {
    sdk?: AffixSDK;
    apiKey?: string;
    operatorBaseDir?: string;
};

export declare function runSetupWizard(options?: InteractiveOptions): Promise<void>;
export declare function runInteractive(options?: InteractiveOptions): Promise<void>;
