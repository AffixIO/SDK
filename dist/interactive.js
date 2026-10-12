/* Credit: @paparichens */
import { createInterface } from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { AffixSDK } from "./index.js";
import { defaultOperatorConfig, loadApiKey } from "./operator-config.js";

function resolveApiKey(overrides = {}) {
    const baseDir = overrides.operatorBaseDir ?? ".affix";
    return (overrides.apiKey
        ?? process.env.AFFIX_API_KEY
        ?? loadApiKey(baseDir)
        ?? "setup_pending");
}

function sdkFromEnv(overrides = {}) {
    const apiKey = resolveApiKey(overrides);
    return new AffixSDK({
        apiKey,
        autoFlush: false,
        ...overrides,
        apiKey,
    });
}

/**
 * Line reader that buffers input arriving before a prompt is issued.
 * Piped and here-doc input would otherwise be dropped between prompts.
 * `question` resolves to null once the stream ends.
 */
function createPrompter() {
    const rl = createInterface({ input, output, terminal: input.isTTY === true });
    const pending = [];
    const waiting = [];
    let ended = false;
    rl.on("line", (line) => {
        const next = waiting.shift();
        if (next)
            next(line);
        else
            pending.push(line);
    });
    rl.on("close", () => {
        ended = true;
        while (waiting.length)
            waiting.shift()(null);
    });
    return {
        get ended() {
            return ended && pending.length === 0;
        },
        question(text) {
            output.write(text);
            if (pending.length)
                return Promise.resolve(pending.shift());
            if (ended)
                return Promise.resolve(null);
            return new Promise((resolve) => waiting.push(resolve));
        },
        close() {
            rl.close();
        },
    };
}

async function promptLine(rl, label, fallback) {
    const raw = await rl.question(`${label}${fallback !== undefined ? ` [${fallback}]` : ""}: `);
    if (raw === null) {
        output.write("\n");
        return fallback;
    }
    return raw.trim() || fallback;
}

async function promptSecret(rl, label) {
    const raw = await rl.question(`${label}: `);
    return raw === null ? "" : raw.trim();
}

async function runSetApiKey(rl, sdk) {
    const status = sdk.apiKeyStatus();
    if (status.configured) {
        console.log(`Current key hint: ${status.key_hint} (stored=${status.stored})`);
    }
    else {
        console.log("No Affix API key configured yet.");
    }
    const key = await promptSecret(rl, "Affix API key");
    if (!key) {
        console.log("No key entered. Unchanged.");
        return;
    }
    const saved = sdk.setApiKey(key);
    console.log(`API key saved to ${saved.path} (mode 0600). Hint: ${saved.key_hint}`);
    const ping = (await promptLine(rl, "Ping licence now? (yes|no)", "yes")) !== "no";
    if (ping) {
        const ok = await sdk.checkLicence(true);
        console.log(JSON.stringify({ ok, state: sdk.licenceState() }, null, 2));
    }
}

const HSM_MENU = `
HSM connection
  Supported providers:
    Hardware PKCS#11: pkcs11, softhsm, thales, utimaco, ncipher, yubihsm
    Cloud:            aws_cloudhsm, aws_kms, azure_key_vault, azure_managed_hsm,
                      gcp_kms, google_cloud_hsm, fortanix, generic_http, custom
  PINs and cloud credentials are never stored in config. Use environment variables.
`;

async function runHsmMenu(rl, sdk) {
    console.log(HSM_MENU);
    const current = sdk.hsmStatus();
    if (current.configured) {
        console.log(`Current: ${current.provider} (${current.label}) enabled=${current.enabled}`);
    }
    else {
        console.log("No HSM configured.");
    }
    const action = (await promptLine(rl, "Action (connect|test|status|clear)", current.configured ? "test" : "connect")).toLowerCase();
    if (action === "status") {
        console.log(JSON.stringify(current, null, 2));
        return;
    }
    if (action === "clear") {
        console.log(JSON.stringify(await sdk.clearHsmProfile(), null, 2));
        return;
    }
    if (action === "test") {
        if (!current.configured) {
            console.log("Configure an HSM first (action: connect).");
            return;
        }
        console.log(JSON.stringify(await sdk.testHsm(), null, 2));
        return;
    }
    if (action !== "connect" && action !== "configure" && action !== "set") {
        console.log("Unknown HSM action.");
        return;
    }
    const provider = (await promptLine(rl, "Provider", current.provider ?? "pkcs11")).toLowerCase();
    const profile = {
        provider,
        label: await promptLine(rl, "Label", current.label ?? provider),
        key_label: await promptLine(rl, "Key label (optional)", current.key_label ?? "") || null,
        key_id: await promptLine(rl, "Key id (optional)", current.key_id ?? "") || null,
        prefer_for_signing: (await promptLine(rl, "Prefer HSM for local signing? (yes|no)", "no")) === "yes",
        enabled: true,
    };
    if (["pkcs11", "softhsm", "thales", "utimaco", "ncipher", "yubihsm"].includes(provider)) {
        profile.library_path = await promptLine(rl, "PKCS#11 library path", current.library_path ?? "/usr/lib/softhsm/libsofthsm2.so");
        const slot = await promptLine(rl, "Slot index (optional)", current.slot != null ? String(current.slot) : "");
        profile.slot = slot === "" ? null : Number(slot);
        profile.pin_env = await promptLine(rl, "PIN env var name", "AFFIX_HSM_PIN");
    }
    else if (provider === "aws_cloudhsm" || provider === "aws_kms") {
        profile.region = await promptLine(rl, "AWS region", current.region ?? "eu-west-2");
        profile.cluster_id = await promptLine(rl, "CloudHSM cluster id (optional)", "") || null;
        profile.endpoint = await promptLine(rl, "Endpoint override (optional)", current.endpoint ?? "") || null;
        profile.access_key_env = await promptLine(rl, "Access key env var", "AWS_ACCESS_KEY_ID");
        profile.secret_key_env = await promptLine(rl, "Secret key env var", "AWS_SECRET_ACCESS_KEY");
    }
    else if (provider === "azure_key_vault" || provider === "azure_managed_hsm") {
        profile.vault_uri = await promptLine(rl, "Vault URI", current.vault_uri ?? "https://example.vault.azure.net");
        profile.token_env = await promptLine(rl, "Token env var", "AFFIX_HSM_TOKEN");
    }
    else if (provider === "gcp_kms" || provider === "google_cloud_hsm") {
        profile.project_id = await promptLine(rl, "GCP project id", current.project_id ?? "");
        profile.region = await promptLine(rl, "Location/region", current.region ?? "europe-west2");
        profile.key_id = await promptLine(rl, "Crypto key resource id (optional)", current.key_id ?? "") || null;
    }
    else {
        profile.endpoint = await promptLine(rl, "HSM HTTP endpoint", current.endpoint ?? "https://hsm.example.com");
        profile.token_env = await promptLine(rl, "Token env var", "AFFIX_HSM_TOKEN");
        const health = await promptLine(rl, "Health path", "/");
        profile.meta = { health_path: health };
    }
    const saved = await sdk.setHsmProfile(profile);
    console.log(JSON.stringify({ saved }, null, 2));
    const probe = (await promptLine(rl, "Probe HSM now? (yes|no)", "yes")) !== "no";
    if (probe) {
        console.log(JSON.stringify(await sdk.testHsm(), null, 2));
    }
}

async function runSetup(rl, sdk) {
    const { config } = sdk.operatorConfig();
    const next = { ...defaultOperatorConfig(), ...config };
    const status = sdk.apiKeyStatus();
    const setKey = (await promptLine(rl, status.configured
        ? `Set Affix API key? current ${status.key_hint} (yes|no)`
        : "Set Affix API key now? (yes|no)", status.configured ? "no" : "yes")) !== "no";
    if (setKey) {
        const key = await promptSecret(rl, "Affix API key");
        if (key) {
            const saved = sdk.setApiKey(key);
            console.log(`API key saved (${saved.key_hint}).`);
        }
    }
    next.proofMode = (await promptLine(rl, "Proof mode (hmac|ultrahonk)", next.proofMode)) === "ultrahonk"
        ? "ultrahonk"
        : "hmac";
    next.licenceOnly = (await promptLine(rl, "Licence-only mode (yes|no)", next.licenceOnly ? "yes" : "no")) !== "no";
    next.apiBase = await promptLine(rl, "Affix licence URL", next.apiBase);
    const presentment = await promptLine(rl, "Presentment URL (optional)", next.presentmentBase ?? "");
    next.presentmentBase = presentment || null;
    next.storage.proofs = await promptLine(rl, "Proof store path", next.storage.proofs);
    next.storage.spendDir = await promptLine(rl, "Spend journal directory", next.storage.spendDir);
    const internalUrl = await promptLine(rl, "Internal data API base URL (optional)", next.connections.internal?.baseUrl ?? "");
    if (internalUrl) {
        next.connections.internal = {
            name: "internal",
            baseUrl: internalUrl,
            pathTemplate: "/records/:id",
            authEnv: await promptLine(rl, "Internal auth env var", "INTERNAL_API_TOKEN"),
        };
    }
    const externalUrl = await promptLine(rl, "External data API base URL (optional)", next.connections.external?.baseUrl ?? "");
    if (externalUrl) {
        next.connections.external = {
            name: "external",
            baseUrl: externalUrl,
            pathTemplate: "/records/:id",
            authEnv: await promptLine(rl, "External auth env var", "EXTERNAL_API_TOKEN"),
        };
    }
    await sdk.saveOperatorConfig(next);
    const configureHsm = (await promptLine(rl, "Configure HSM now? (yes|no)", "no")) === "yes";
    if (configureHsm) {
        await runHsmMenu(rl, sdk);
    }
    console.log("Configuration saved under .affix/config.json. Secrets (including API key) remain in .affix/secrets/.");
}

async function runProve(rl, sdk) {
    const mode = await promptLine(rl, "Mode (auto|offline|online)", "auto");
    const proofMode = (await promptLine(rl, "Proof mode (hmac|ultrahonk)", sdk.config.proofMode ?? "hmac")) === "ultrahonk"
        ? "ultrahonk"
        : "hmac";
    const claim = await promptLine(rl, "Claim value", "approved");
    const now = Math.floor(Date.now() / 1000);
    const result = await sdk.prove({
        mode,
        proofMode,
        circuitId: "simple_yesno",
        credential: {
            schema_id: "interactive_v1",
            issuer_id: "local_operator",
            issuer_pubkey_hash: "0x1",
            credential_id: `0x${Date.now().toString(16)}`,
            claim_value: claim,
            valid_from: now - 86400,
            valid_until: now + 86400 * 365,
        },
        context: {
            secret: await promptLine(rl, "Context secret", "affix-operator-secret"),
            context_id: await promptLine(rl, "Context id", "affix-operator-context"),
            required_claim_hash: await promptLine(rl, "Required claim", claim),
        },
    });
    console.log(JSON.stringify({
        proof_id: result.proof_id,
        proof_mode: result.proof_mode,
        decision: result.decision,
        proof_digest: result.proof_digest,
        envelope_ok: Boolean(result.envelope),
    }, null, 2));
}

async function runVerifyLocal(rl, sdk) {
    const proof = await promptLine(rl, "Proof hex");
    if (!proof) {
        console.log("No proof supplied.");
        return;
    }
    const circuitId = await promptLine(rl, "Circuit", "simple_yesno");
    const result = await sdk.verifyLocal(circuitId, proof);
    console.log(JSON.stringify(result, null, 2));
}

async function runStats(sdk) {
    const stats = await sdk.statsSnapshot();
    const spend = sdk.spendStatus();
    const licence = sdk.licenceState();
    console.log(JSON.stringify({ stats, spend, licence, api_key: sdk.apiKeyStatus() }, null, 2));
}

async function runConnections(sdk) {
    const result = await sdk.testConnections();
    console.log(JSON.stringify(result, null, 2));
}

async function runSpendAudit(sdk) {
    const integrity = sdk.verifySpendJournal();
    const status = sdk.spendStatus();
    console.log(JSON.stringify({ integrity, status }, null, 2));
}

async function runLicence(sdk) {
    const status = sdk.apiKeyStatus();
    if (!status.configured) {
        console.log("No API key set. Use menu option A first.");
        return;
    }
    const ok = await sdk.checkLicence(true);
    console.log(JSON.stringify({ ok, state: sdk.licenceState() }, null, 2));
}

async function runConfigDisplay(sdk) {
    const { config, paths } = sdk.operatorConfig();
    const pubkey = sdk.exportLocalPublicKey();
    console.log(JSON.stringify({
        config,
        paths,
        public_key: pubkey,
        api_key: sdk.apiKeyStatus(),
        hsm: sdk.hsmStatus(),
    }, null, 2));
}

async function runProofSearch(sdk) {
    const proofs = await sdk.listStoredProofs();
    console.log(JSON.stringify(proofs.slice(0, 20), null, 2));
}

const MENU = `
Affix SDK operator menu
  A  Set Affix API key
  H  Connect HSM (hardware or cloud)
  1  Guided setup
  2  Licence status
  3  Test connections
  4  Prove (HMAC or UltraHonk)
  5  Verify locally
  6  Spend journal audit
  7  Operational stats
  8  List stored proofs
  9  Show configuration
  0  Exit
`;

export async function runSetupWizard(options = {}) {
    const sdk = options.sdk ?? sdkFromEnv(options);
    const rl = createPrompter();
    try {
        await runSetup(rl, sdk);
    }
    finally {
        rl.close();
    }
}

export async function runInteractive(options = {}) {
    const sdk = options.sdk ?? sdkFromEnv(options);
    const rl = createPrompter();
    try {
        console.log("Affix SDK interactive terminal. Ctrl+C to exit.");
        const status = sdk.apiKeyStatus();
        if (status.configured) {
            console.log(`API key: ${status.key_hint}`);
        }
        else {
            console.log("API key: not set (choose A to add one).");
        }
        const hsm = sdk.hsmStatus();
        if (hsm.configured) {
            console.log(`HSM: ${hsm.provider} (${hsm.label})`);
        }
        else {
            console.log("HSM: not set (choose H to connect hardware or cloud).");
        }
        while (true) {
            console.log(MENU);
            const raw = await rl.question("Select: ");
            if (raw === null) {
                output.write("\n");
                break;
            }
            const choice = raw.trim().toLowerCase();
            if (choice === "0" || choice === "exit" || choice === "q") {
                break;
            }
            try {
                if (choice === "a")
                    await runSetApiKey(rl, sdk);
                else if (choice === "h")
                    await runHsmMenu(rl, sdk);
                else if (choice === "1")
                    await runSetup(rl, sdk);
                else if (choice === "2")
                    await runLicence(sdk);
                else if (choice === "3")
                    await runConnections(sdk);
                else if (choice === "4")
                    await runProve(rl, sdk);
                else if (choice === "5")
                    await runVerifyLocal(rl, sdk);
                else if (choice === "6")
                    await runSpendAudit(sdk);
                else if (choice === "7")
                    await runStats(sdk);
                else if (choice === "8")
                    await runProofSearch(sdk);
                else if (choice === "9")
                    await runConfigDisplay(sdk);
                else
                    console.log("Unknown option.");
            }
            catch (err) {
                console.error(err instanceof Error ? err.message : String(err));
            }
        }
    }
    finally {
        rl.close();
        sdk.dispose();
    }
}
