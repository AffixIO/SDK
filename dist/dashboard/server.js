/* AffixIO local ops dashboard server. Credit: @paparichens */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { AffixSDK, createAgentTrust } from "../index.js";
import { loadApiKey } from "../operator-config.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dir, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
};

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 2_000_000) {
        reject(new Error("body_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("invalid_json"));
      }
    });
    req.on("error", reject);
  });
}

function safePublicPath(urlPath) {
  const cleaned = decodeURIComponent(urlPath.split("?")[0] || "/");
  const rel = cleaned === "/" ? "index.html" : cleaned.replace(/^\/+/, "");
  const full = normalize(join(PUBLIC_DIR, rel));
  if (!full.startsWith(PUBLIC_DIR)) return null;
  return full;
}

async function serveStatic(req, res) {
  const path = safePublicPath(req.url || "/");
  if (!path || !existsSync(path)) {
    json(res, 404, { error: "not_found" });
    return;
  }
  const data = await readFile(path);
  const type = MIME[extname(path)] || "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": type,
    "Cache-Control": path.endsWith("index.html") ? "no-store" : "public, max-age=60",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(data);
}

/**
 * Start the local AffixIO ops dashboard (KYA + live operator data).
 * Binds to 127.0.0.1 by default for self-hosted ops.
 */
export async function runDashboard(options = {}) {
  const host = options.host ?? process.env.AFFIX_DASHBOARD_HOST ?? "127.0.0.1";
  const port = Number(options.port ?? process.env.AFFIX_DASHBOARD_PORT ?? 8787);
  const operatorBaseDir = options.operatorBaseDir ?? ".affix";
  const kyaStorageDir = options.kyaStorageDir ?? join(operatorBaseDir, "kya");
  const apiKey =
    options.apiKey ??
    process.env.AFFIX_API_KEY ??
    loadApiKey(operatorBaseDir) ??
    "local_operator";
  const apiBase =
    options.apiBase ?? process.env.AFFIX_API_BASE ?? "https://api.affix-io.com";

  const sdk = options.sdk ??
    new AffixSDK({
      apiKey,
      apiBase,
      autoFlush: false,
      operatorBaseDir,
      proofMode: process.env.AFFIX_PROOF_MODE ?? "hmac",
      licenceOnly: process.env.AFFIX_LICENCE_ONLY === "0" ? false : undefined,
    });

  const trust = createAgentTrust({
    sdk,
    apiKey,
    apiBase,
    storageDir: kyaStorageDir,
    licenceOnly: process.env.AFFIX_LICENCE_ONLY === "0" ? false : true,
  });

  const state = {
    lastCredential: null,
    startedAt: new Date().toISOString(),
  };

  async function liveSnapshot() {
    const [stats, flush, proofs, queue, online] = await Promise.all([
      sdk.statsSnapshot(),
      sdk.autoFlushStatus(),
      sdk.listStoredProofs().catch(() => []),
      sdk.listPendingSync().catch(() => []),
      sdk.isOnline().catch(() => false),
    ]);
    const licence = sdk.licenceState();
    const key = sdk.apiKeyStatus();
    const spend = sdk.spendStatus();
    const hsm = sdk.hsmStatus();
    const { config, paths } = sdk.operatorConfig();
    return {
      ok: true,
      at: new Date().toISOString(),
      started_at: state.startedAt,
      api_base: sdk.apiBase,
      online: Boolean(online),
      licence,
      api_key: {
        configured: key.configured,
        key_hint: key.key_hint,
        stored: key.stored,
      },
      flush,
      stats,
      spend,
      hsm,
      proofs: {
        stored: proofs.length,
        recent: proofs.slice(-12).reverse().map((p) => ({
          proof_id: p.proof_id,
          circuit_id: p.circuit_id,
          decision: p.decision,
          proof_mode: p.proof_mode,
          origin: p.origin,
          request_id: p.request_id,
          created_at: p.created_at ?? p.stored_at ?? null,
        })),
      },
      queue: {
        pending: queue.length,
        items: queue.slice(0, 20).map((j) => ({
          proof_id: j.proof_id,
          circuit_id: j.circuit_id,
          decision: j.decision,
          enqueued_at: j.enqueued_at ?? null,
        })),
      },
      kya: {
        receipts: trust.receipts.length,
        last_agent_id: state.lastCredential?.agent_id ?? null,
        has_credential: Boolean(state.lastCredential),
        recent_receipts: trust.receipts.slice(-20).reverse(),
      },
      config: {
        proofMode: config.proofMode,
        licenceOnly: config.licenceOnly,
        autoFlush: config.autoFlush,
        allowOfflineProve: config.allowOfflineProve,
        paths,
      },
    };
  }

  async function handleApi(req, res, pathname) {
    try {
      if (req.method === "GET" && pathname === "/api/health") {
        json(res, 200, { ok: true, service: "affixio-dashboard", at: new Date().toISOString() });
        return;
      }
      if (req.method === "GET" && pathname === "/api/live") {
        json(res, 200, await liveSnapshot());
        return;
      }
      if (req.method === "POST" && pathname === "/api/licence/check") {
        const ok = await sdk.checkLicence(true);
        json(res, 200, { ok, state: sdk.licenceState() });
        return;
      }
      if (req.method === "POST" && pathname === "/api/flush") {
        const body = await readBody(req);
        const result = await sdk.flushOfflineQueue({
          maxItems: Number(body.maxItems ?? 100) || 100,
        });
        json(res, 200, { ok: true, result });
        return;
      }
      if (req.method === "POST" && pathname === "/api/kya/enrol") {
        const body = await readBody(req);
        if (!body.agentId || !Array.isArray(body.capabilities)) {
          json(res, 400, { error: "agentId_and_capabilities_required" });
          return;
        }
        const credential = await trust.enrol({
          agentId: body.agentId,
          holder: body.holder ?? "local-dashboard",
          model: body.model,
          capabilities: body.capabilities,
          ttlSeconds: body.ttlSeconds ?? 3600,
          metadata: body.metadata ?? { source: "affixio-dashboard" },
        });
        state.lastCredential = credential;
        json(res, 201, { ok: true, credential });
        return;
      }
      if (req.method === "POST" && pathname === "/api/kya/verify") {
        const body = await readBody(req);
        const credential = body.credential ?? state.lastCredential;
        if (!credential) {
          json(res, 400, { error: "credential_required" });
          return;
        }
        const result = await trust.verifyCredential(credential);
        json(res, 200, { ok: true, ...result });
        return;
      }
      if (req.method === "POST" && pathname === "/api/kya/authorise") {
        const body = await readBody(req);
        const credential = body.credential ?? state.lastCredential;
        if (!credential || !body.action) {
          json(res, 400, { error: "credential_and_action_required" });
          return;
        }
        const receipt = await trust.authorise({
          credential,
          action: body.action,
          resource: body.resource,
          args: body.args ?? { source: "affixio-dashboard" },
          attest: Boolean(body.attest),
        });
        json(res, 200, { ok: true, receipt });
        return;
      }
      if (req.method === "POST" && pathname === "/api/kya/audit") {
        const body = await readBody(req);
        const audit = await trust.buildAuditTrail({
          receipts: body.receipts,
        });
        json(res, 200, { ok: true, audit });
        return;
      }
      if (req.method === "GET" && pathname === "/api/kya/credential") {
        json(res, 200, {
          ok: true,
          credential: state.lastCredential,
        });
        return;
      }
      json(res, 404, { error: "unknown_route" });
    } catch (err) {
      json(res, 400, {
        error: "request_failed",
        message: String(err?.message || err),
      });
    }
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${host}:${port}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url.pathname);
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      json(res, 405, { error: "method_not_allowed" });
      return;
    }
    try {
      await serveStatic(req, res);
    } catch (err) {
      json(res, 500, { error: "static_failed", message: String(err?.message || err) });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });

  const url = `http://${host}:${port}/`;
  const shutdown = () => {
    try {
      trust.dispose();
    } catch {
      /* ignore */
    }
    try {
      sdk.dispose();
    } catch {
      /* ignore */
    }
    server.close();
  };

  return { server, url, host, port, shutdown, sdk, trust };
}

export default runDashboard;
