#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { verifyEvidenceBundle } from "./browser.js";
import { evidenceReport } from "./evidence.js";
import { replayPolicy } from "./decisions.js";

const [command, file, ...args] = process.argv.slice(2);
const readJson = async path => JSON.parse(await readFile(path, "utf8"));
try {
  if (command === "verify" && file) {
    const bundle = await readJson(file);
    const trustedPublicKeys = [];
    const trustedKeys = [];
    let report;
    let acceptV1 = false;
    for (let i = 0; i < args.length; i += 2) {
      if (!args[i + 1]) throw new Error("Missing option value");
      if (args[i] === "--trusted-key" || args[i] === "--trusted-keyset") {
        // Accepts a bare base64 key, a { key_id, public_key_b64 } JSON file, or a key set JSON ({ keys: [...] }, e.g. GET https://api.affix-io.com/v1/keys).
        const text = (await readFile(args[i + 1], "utf8")).trim();
        if (text.startsWith("{") || text.startsWith("[")) {
          const doc = JSON.parse(text);
          trustedKeys.push(...(Array.isArray(doc) ? doc : Array.isArray(doc.keys) ? doc.keys : [doc]));
        } else trustedPublicKeys.push(text);
      }
      else if (args[i] === "--report") report = args[i + 1];
      else if (args[i] === "--accept-legacy-v1" && args[i + 1] === "yes") acceptV1 = true;
      else throw new Error("Unknown option");
    }
    if (bundle?.signature && !trustedPublicKeys.length && !trustedKeys.length)
      throw new Error("No trusted key given. Pin the signer with --trusted-key <file> (or --trusted-keyset keys.json). The key embedded in the bundle is never trusted.");
    const result = await verifyEvidenceBundle(bundle, { trustedPublicKeys, trustedKeys, rejectLegacyV1: !acceptV1 });
    if (report) await writeFile(report, evidenceReport(bundle, result), { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.integrityValid && result.signatureValid ? 0 : 1;
  } else if (command === "replay" && file && args.length === 1) {
    console.log(JSON.stringify(replayPolicy(await readJson(file), await readJson(args[0])), null, 2));
  } else {
    console.log("affixio-evidence verify bundle.json --trusted-key public-key.txt|key.json [--trusted-keyset keys.json] [--report report.html] [--accept-legacy-v1 yes]\naffixio-evidence replay policy.json cases.json");
    process.exitCode = 2;
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
