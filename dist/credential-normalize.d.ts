import type { AffixCredential } from "./types.js";
/** Noir witness inputs need field elements; hash string labels the same way the API does. */
export declare function normalizeCredential(credential: AffixCredential): AffixCredential;
