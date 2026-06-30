import type { AffixCredential, WitnessContext, WitnessPackage } from "./types.js";
import type { AffixApiClient } from "./client.js";
export declare function randomFieldHex(): string;
export declare function defaultContext(overrides?: Partial<WitnessContext>): WitnessContext;
export declare function prepareWitness(client: AffixApiClient, circuitId: string, credential: AffixCredential, context: WitnessContext): Promise<WitnessPackage>;
export declare function witnessFromInputs(circuitId: string, inputs: Record<string, string>): WitnessPackage;
