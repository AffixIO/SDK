import type { AffixSDK } from "../index.js";
import { CodeUseStore } from "./spent-store.js";
import type { GenerateCodeFromProveInput, GenerateCodeInput, GeneratedCode, ReadCodeInput, ReadCodeResult } from "./types.js";
export declare function generateZkCode(sdk: AffixSDK, input: GenerateCodeInput): Promise<GeneratedCode>;
export declare function generateZkCodeFromProve(sdk: AffixSDK, input: GenerateCodeFromProveInput): Promise<GeneratedCode>;
/**
 * Scan a QR/barcode online or offline.
 * Local UltraHonk check always runs. Affix signs when mode allows and the API is up.
 * Offline admits are queued for Affix verify + ML-DSA attestation on flush.
 */
export declare function readZkCode(sdk: AffixSDK, input: ReadCodeInput, useStore?: CodeUseStore): Promise<ReadCodeResult>;
