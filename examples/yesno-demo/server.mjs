/* Credit: @paparichens */
import "dotenv/config";
import express from "express";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AffixSDK, loadApiKey } from "affixio";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3847);
const operatorBaseDir = path.join(__dirname, ".affix");

function resolveApiKey() {
  const fromEnv = process.env.AFFIX_API_KEY?.trim();
  const fromStore = loadApiKey(operatorBaseDir);
  const apiKey = fromEnv || fromStore || "";

  if (!apiKey.startsWith("aio_live_")) {
    console.error("AFFIX_API_KEY is required. Use your aio_live_... key from Hub.");
    console.error("  cp env.example .env");
    console.error("  npx affixio set-key --api-key aio_live_...");
    process.exit(1);
  }

  return apiKey;
}

const apiKey = resolveApiKey();

const sdk = new AffixSDK({
  operatorBaseDir,
  apiKey,
  apiBase: process.env.AFFIX_API_BASE,
  hmacSecret: process.env.AFFIX_LOCAL_HMAC_SECRET,
});

const licenceOk = await sdk.licence.check(true);
if (!licenceOk) {
  console.error("Licence check failed. Confirm your key is active in Hub.");
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: "512kb" }));
app.use(express.static(path.join(__dirname, "public")));

function quotaSnapshot() {
  const quota = sdk.licence.state?.quota;
  if (!quota || typeof quota !== "object") {
    return null;
  }
  return {
    limit: quota.limit ?? null,
    used: quota.used ?? null,
    remaining: quota.remaining ?? null,
    is_trial: Boolean(quota.is_trial),
    trial_expires_at: quota.trial_expires_at ?? null,
  };
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    mode: "auto",
    circuit: "simple_yesno",
    licence: {
      active: Boolean(sdk.licence.state?.ok),
      message: sdk.licence.state?.message ?? null,
      key_hint: sdk.licence.state?.key_hint ?? null,
    },
    quota: quotaSnapshot(),
    hub_stats_url: "https://hub.affix-io.com/",
  });
});

app.post("/api/prove", async (req, res) => {
  try {
    const claim = String(req.body.claim ?? "").trim();
    const required = String(req.body.required ?? "").trim();
    if (!claim || !required) {
      return res.status(400).json({ error: "claim and required are required" });
    }

    const pass = claim === required;
    const now = Math.floor(Date.now() / 1000);
    const requestId = randomUUID();

    const result = await sdk.prove({
      mode: "auto",
      circuitId: "simple_yesno",
      request_id: requestId,
      decision: pass ? "yes" : "no",
      credential: {
        schema_id: "affix_yesno_demo",
        issuer_id: "local_demo",
        issuer_pubkey_hash: "0x1",
        credential_id: `demo:${requestId}`,
        claim_value: claim,
        valid_from: now - 60,
        valid_until: now + 86_400 * 30,
        fields: { claim, required },
      },
      context: {
        secret: `demo-secret:${requestId}`,
        context_id: `demo-context:${requestId}`,
        required_claim_hash: required,
      },
    });

    res.json({
      decision: result.decision,
      valid: result.valid,
      pass,
      offline: result.offline,
      proof: result.proof,
      envelope: result.envelope,
      proof_id: result.proof_id,
      proof_digest: result.proof_digest,
      signature: result.signature,
      quota: quotaSnapshot(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("licence") || message.includes("Licence") ? 403 : 500;
    res.status(status).json({ error: message });
  }
});

app.post("/api/verify", async (req, res) => {
  try {
    const proof = String(req.body.proof ?? "").trim();
    if (!proof) {
      return res.status(400).json({ error: "proof is required" });
    }

    const circuitId = req.body.circuitId ?? "simple_yesno";
    const options = req.body.envelope ? { envelope: req.body.envelope } : {};
    const result = await sdk.verifyLocal(circuitId, proof, options);

    res.json(result);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

const server = app.listen(PORT, "0.0.0.0", () => {
  const quota = quotaSnapshot();
  console.log(`AffixIO yes/no demo running at http://127.0.0.1:${PORT}`);
  console.log(`Licence active (${sdk.licence.state?.key_hint ?? "key set"}).`);
  if (quota) {
    console.log(
      `Quota: ${quota.used ?? 0} used, ${quota.remaining ?? 0} remaining of ${quota.limit ?? 0}.`,
    );
  }
  console.log("Proofs report to Hub stats via quota consume.");
});

server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use.`);
    console.error("Stop the other demo instance, or run on a different port:");
    console.error(`  PORT=${PORT + 1} npm start`);
    console.error("Linux:");
    console.error(`  fuser -k ${PORT}/tcp`);
    console.error(`  kill $(lsof -t -i:${PORT})`);
    process.exit(1);
  }
  throw err;
});
