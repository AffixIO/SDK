import type { AffixCredential, WitnessContext, WitnessPackage } from "./types.js";
export declare function isAffixCircuit(circuitId: string): boolean;
/**
 * Coerce every witness value into a canonical field element.
 * Arbitrary text is reduced by hash, so callers never need to supply hex.
 */
export declare function normaliseWitnessInputs(inputs: Record<string, unknown>): Record<string, string>;
export declare function normaliseWitnessPackage(witness: WitnessPackage): WitnessPackage;
/**
 * Build witness for bundled yes/no circuits (matches Affix API witness layout).
 */
export declare function buildYesNoWitness(circuitId: string, credential: AffixCredential, context: WitnessContext): WitnessPackage;
export declare function defaultContext(partial?: Partial<WitnessContext>): WitnessContext;
