#!/usr/bin/env node
/* Credit: @paparichens */
import { AffixSDK, LicenceOnlyError } from "./index.js";
import { runInteractive, runSetupWizard } from "./interactive.js";
import { loadApiKey } from "./operator-config.js";

function arg(name) {
    const idx = process.argv.indexOf(name);
    if (idx === -1)
        return undefined;
    return process.argv[idx + 1];
}

const LOCAL_COMMANDS = new Set([
    "help",
    "--help",
    "interactive",
    "menu",
    "setup",
    "stats",
    "spend-status",
    "verify-local",
    "config",
    "pubkey",
    "set-key",
    "hsm",
    "dashboard",
]);

function requiresApiKey(command) {
    return !LOCAL_COMMANDS.has(command);
}

function haveApiKey() {
    return Boolean(process.env.AFFIX_API_KEY ?? arg("--api-key") ?? loadApiKey(".affix"));
}

async function buildSdk() {
    const apiKey = process.env.AFFIX_API_KEY ?? arg("--api-key") ?? loadApiKey(".affix") ?? "local_operator";
    return new AffixSDK({
        apiKey,
        apiBase: process.env.AFFIX_API_BASE ?? "https://api.affix-io.com",
        presentmentBase: process.env.AFFIX_PRESENTMENT_BASE ?? arg("--link-base"),
        autoFlush: false,
        proofMode: (arg("--proof-mode") ?? process.env.AFFIX_PROOF_MODE) as "hmac" | "ultrahonk" | undefined,
        licenceOnly: process.env.AFFIX_LICENCE_ONLY === "0" ? false : undefined,
    });
}

async function main() {
    const command = process.argv[2] ?? "help";
    if (command === "help" || command === "--help") {
        console.log(`affix-sdk <command>

Commands:
  A / set-key         Save Affix API key to .affix/secrets/api.key
  H / hsm             Connect hardware or cloud HSM (pkcs11, AWS, Azure, GCP, …)
  interactive | menu  Guided operator menu (setup, prove, audit, stats)
  dashboard           Local ops UI (KYA + live data) on 127.0.0.1:8787
  setup               Write .affix/config.json via prompts
  health              Public API health (non-licence-only hosts)
  licence             Force licence ping (API key)
  prove               Local prove (--proof-mode hmac|ultrahonk, --offline)
  verify-local <hex>  Local HMAC or UltraHonk verify
  verify <proof-hex>  Remote Affix verify (disabled in licence-only mode)
  flush               Push offline queue (disabled in licence-only mode)
  queue               List pending offline proofs
  list                Stored local proofs
  stats               Local operational counters
  spend-status        Tamper-evident spend journal status
  test-connections    Licence + internal/external HTTP profiles
  config              Show operator configuration (no secrets)
  pubkey              Export local ML-DSA-65 public key
  qr                  Generate ZK QR (--claim, --scans, --out, --link-base)
  barcode             Generate ZK barcode
  read <scanned>      Scan carrier or presentment URL (--consume, --sidecar)

Env: AFFIX_API_KEY, AFFIX_API_BASE, AFFIX_PROOF_MODE, AFFIX_LICENCE_ONLY,
     AFFIX_PRESENTMENT_BASE, AFFIX_LOCAL_HMAC_SECRET,
     AFFIX_DASHBOARD_HOST, AFFIX_DASHBOARD_PORT
     (API key may also be stored under .affix/secrets/api.key)

Dashboard flags: --host 127.0.0.1 --port 8787
`);
        return;
    }
    if (command === "interactive" || command === "menu") {
        await runInteractive();
        return;
    }
    if (command === "dashboard") {
        const { runDashboard } = await import("./dashboard/server.js");
        const host = arg("--host") ?? process.env.AFFIX_DASHBOARD_HOST ?? "127.0.0.1";
        const port = Number(arg("--port") ?? process.env.AFFIX_DASHBOARD_PORT ?? 8787);
        const { url, shutdown } = await runDashboard({ host, port });
        console.log(`AffixIO local ops dashboard: ${url}`);
        console.log("KYA and live operator data. Ctrl+C to stop.");
        const stop = () => {
            shutdown();
            process.exit(0);
        };
        process.on("SIGINT", stop);
        process.on("SIGTERM", stop);
        await new Promise(() => {});
        return;
    }
    if (requiresApiKey(command) && !haveApiKey()) {
        console.error("No API key. Run `affix-sdk set-key --api-key <value>`, set AFFIX_API_KEY, or pass --api-key.");
        process.exit(1);
    }
    const sdk = await buildSdk();
    try {
        if (command === "setup") {
            await runSetupWizard({ sdk });
            return;
        }
        if (command === "set-key") {
            const positional = process.argv[3]?.startsWith("--") ? undefined : process.argv[3];
            const key = arg("--key") ?? arg("--api-key") ?? positional;
            if (!key) {
                console.error("set-key requires --key <value>, --api-key <value>, or a positional key");
                process.exit(1);
            }
            if (key.startsWith("--") || key.length < 12) {
                console.error("Refusing to store an implausible API key. Pass the full key value.");
                process.exit(1);
            }
            const saved = sdk.setApiKey(key);
            console.log(JSON.stringify(saved, null, 2));
            return;
        }
        if (command === "hsm") {
            const sub = process.argv[3] ?? "status";
            if (sub === "status") {
                console.log(JSON.stringify(sdk.hsmStatus(), null, 2));
                return;
            }
            if (sub === "test") {
                const result = await sdk.testHsm();
                console.log(JSON.stringify(result, null, 2));
                process.exit(result.ok ? 0 : 2);
            }
            if (sub === "clear") {
                console.log(JSON.stringify(await sdk.clearHsmProfile(), null, 2));
                return;
            }
            if (sub === "connect" || sub === "set") {
                const provider = arg("--provider") ?? "pkcs11";
                const profile = {
                    provider,
                    label: arg("--label") ?? provider,
                    library_path: arg("--library") ?? null,
                    endpoint: arg("--endpoint") ?? null,
                    region: arg("--region") ?? null,
                    vault_uri: arg("--vault") ?? null,
                    project_id: arg("--project") ?? null,
                    key_id: arg("--key-id") ?? null,
                    key_label: arg("--key-label") ?? null,
                    cluster_id: arg("--cluster") ?? null,
                    enabled: true,
                };
                console.log(JSON.stringify(await sdk.setHsmProfile(profile as any), null, 2));
                return;
            }
            console.error("hsm subcommands: status | test | clear | connect");
            process.exit(1);
        }
        if (command === "health") {
            console.log(JSON.stringify(await sdk.client.health(), null, 2));
            return;
        }
        if (command === "licence") {
            const ok = await sdk.checkLicence(true);
            console.log(JSON.stringify({ ok, state: sdk.licenceState() }, null, 2));
            process.exit(ok ? 0 : 2);
        }
        if (command === "stats") {
            console.log(JSON.stringify(await sdk.statsSnapshot(), null, 2));
            return;
        }
        if (command === "spend-status") {
            console.log(JSON.stringify(sdk.spendStatus(), null, 2));
            return;
        }
        if (command === "test-connections") {
            console.log(JSON.stringify(await sdk.testConnections(), null, 2));
            return;
        }
        if (command === "config") {
            const { config, paths } = sdk.operatorConfig();
            console.log(JSON.stringify({ config, paths }, null, 2));
            return;
        }
        if (command === "pubkey") {
            console.log(JSON.stringify(sdk.exportLocalPublicKey(), null, 2));
            return;
        }
        if (command === "list" || command === "proofs") {
            console.log(JSON.stringify(await sdk.listStoredProofs(), null, 2));
            return;
        }
        if (command === "queue") {
            console.log(JSON.stringify(await sdk.listPendingSync(), null, 2));
            return;
        }
        if (command === "flush") {
            const result = await sdk.flushOfflineQueue({
                maxItems: Number(arg("--max") ?? "100") || 100,
            });
            console.log(JSON.stringify(result, null, 2));
            process.exit(result.failed > 0 && result.synced === 0 ? 2 : 0);
        }
        if (command === "prove") {
            const claim = arg("--claim") ?? "approved";
            const now = Math.floor(Date.now() / 1000);
            const offline = process.argv.includes("--offline");
            const proofMode = arg("--proof-mode") ?? sdk.config.proofMode ?? "hmac";
            const result = await sdk.prove({
                mode: offline ? "offline" : "auto",
                proofMode,
                circuitId: arg("--circuit") ?? "simple_yesno",
                credential: {
                    schema_id: "enterprise_eligibility_v1",
                    issuer_id: "affix_demo_issuer",
                    issuer_pubkey_hash: "0x1",
                    credential_id: "0x42",
                    claim_value: claim,
                    valid_from: now - 86400,
                    valid_until: now + 86400 * 365,
                },
                context: {
                    secret: arg("--secret") ?? "affix-demo-secret",
                    context_id: arg("--context") ?? "affix-demo-context",
                    required_claim_hash: arg("--required") ?? claim,
                },
            });
            console.log(JSON.stringify(result, null, 2));
            return;
        }
        if (command === "verify-local") {
            const proof = process.argv[3];
            if (!proof) {
                console.error("verify-local requires proof hex argument");
                process.exit(1);
            }
            const circuitId = arg("--circuit") ?? "simple_yesno";
            const result = await sdk.verifyLocal(circuitId, proof);
            console.log(JSON.stringify(result, null, 2));
            process.exit(result.valid ? 0 : 2);
        }
        if (command === "verify") {
            const proof = process.argv[3];
            if (!proof) {
                console.error("verify requires proof hex argument");
                process.exit(1);
            }
            const circuitId = arg("--circuit") ?? "simple_yesno";
            const result = await sdk.verify(circuitId, proof);
            console.log(JSON.stringify(result, null, 2));
            return;
        }
        function parseScansFlag() {
            const raw = arg("--scans") ?? arg("--max-uses");
            if (raw === undefined)
                return undefined;
            if (raw === "unlimited" || raw === "0")
                return "unlimited";
            const n = Number(raw);
            if (!Number.isFinite(n) || n < 1) {
                throw new Error("--scans must be unlimited, 0, or 1–255");
            }
            return Math.floor(n);
        }
        if (command === "qr" || command === "barcode") {
            const claim = arg("--claim") ?? "approved";
            const now = Math.floor(Date.now() / 1000);
            const maxUses = parseScansFlag();
            const mode = process.argv.includes("--online")
                ? "online"
                : process.argv.includes("--offline")
                    ? "offline"
                    : "auto";
            const linkBase = arg("--link-base") ?? process.env.AFFIX_PRESENTMENT_BASE;
            const wantLink = process.argv.includes("--link");
            const code = await sdk.generateCodeFromProve({
                kind: command === "qr" ? "qr" : "barcode",
                symbology: arg("--symbology") ?? (command === "barcode" ? "code128" : undefined),
                format: process.argv.includes("--png") ? "png" : "svg",
                maxUses: maxUses ?? "unlimited",
                mode,
                presentment: wantLink ? "link" : "carrier",
                presentmentBase: linkBase,
                queueForSync: false,
                save: arg("--out") ? { path: arg("--out"), sidecar: true } : undefined,
                circuitId: arg("--circuit") ?? "simple_yesno",
                proofMode: arg("--proof-mode") ?? sdk.config.proofMode,
                credential: {
                    schema_id: "enterprise_eligibility_v1",
                    issuer_id: "affix_demo_issuer",
                    issuer_pubkey_hash: "0x1",
                    credential_id: `0x${Date.now().toString(16)}`,
                    claim_value: claim,
                    valid_from: now - 86400,
                    valid_until: now + 86400 * 365,
                },
                context: {
                    secret: arg("--secret") ?? "affix-demo-secret",
                    context_id: arg("--context") ?? "affix-demo-context",
                    required_claim_hash: arg("--required") ?? claim,
                },
            });
            console.log(JSON.stringify({
                code_id: code.code_id,
                kind: code.kind,
                symbology: code.symbology,
                carrier_mode: code.carrier_mode,
                max_uses: code.max_uses,
                prove_offline: code.prove.offline,
                pending_sync: code.prove.pending_sync,
                proof_mode: code.prove.proof_mode,
                content: code.content,
                carrier: code.carrier,
                link: code.link ?? null,
                files: code.files,
            }, null, 2));
            return;
        }
        if (command === "read") {
            const scanned = process.argv[3] ?? arg("--data");
            if (!scanned) {
                console.error("read requires scanned payload argument");
                process.exit(1);
            }
            const mode = process.argv.includes("--online")
                ? "online"
                : process.argv.includes("--offline")
                    ? "offline"
                    : "auto";
            const result = await sdk.readCode({
                scanned,
                sidecarPath: arg("--sidecar"),
                consume: process.argv.includes("--consume"),
                mode,
                queueForSync: false,
            });
            console.log(JSON.stringify(result, null, 2));
            process.exit(result.admitted ? 0 : 2);
        }
        console.error(`Unknown command: ${command}`);
        process.exit(1);
    }
    catch (err) {
        if (err instanceof LicenceOnlyError) {
            console.error(err.message);
            process.exit(3);
        }
        console.error(err instanceof Error ? err.message : err);
        process.exit(1);
    }
    finally {
        sdk.dispose();
    }
}
main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
