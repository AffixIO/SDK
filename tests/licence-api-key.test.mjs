import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AffixSDK } from "../dist/index.js";
import { LicenceError } from "../dist/licence.js";

for (const apiKey of [undefined, null, "", "   "]) {
  test(`licenceOnly reports a missing API key (${JSON.stringify(apiKey)})`, () => {
    const dir = mkdtempSync(join(tmpdir(), "affix-missing-key-"));
    try {
      assert.throws(
        () => new AffixSDK({ apiKey, licenceOnly: true, operatorBaseDir: dir, role: "offline-verifier" }),
        error => {
          assert.ok(error instanceof LicenceError);
          assert.equal(error.code, "affixio_api_key_required");
          assert.match(error.message, /apiKey/);
          assert.match(error.message, /pass/i);
          return true;
        },
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("licenceOnly still accepts an explicit API key", () => {
  const dir = mkdtempSync(join(tmpdir(), "affix-present-key-"));
  try {
    const sdk = new AffixSDK({ apiKey: "synthetic-test-key", licenceOnly: true, operatorBaseDir: dir, role: "offline-verifier" });
    assert.equal(sdk.licence.getState().key_hint, "synthe…-key");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
