import { fieldInputHex } from "./field-input.js";
/** Noir witness inputs need field elements; hash string labels the same way the API does. */
export function normalizeCredential(credential) {
    return {
        ...credential,
        schema_id: fieldInputHex(credential.schema_id),
        issuer_pubkey_hash: fieldInputHex(credential.issuer_pubkey_hash),
        credential_id: fieldInputHex(credential.credential_id),
    };
}
