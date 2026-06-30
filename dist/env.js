import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
export const ENV_FILE_PATH = join(packageRoot, ".env");
let loaded = false;
function parseEnvLine(line) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#"))
        return null;
    const eq = trimmed.indexOf("=");
    if (eq <= 0)
        return null;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
    }
    return [key, value];
}
/** Load variables from this package's .env (does not override existing process.env). */
export function loadEnv() {
    if (loaded)
        return;
    loaded = true;
    if (!existsSync(ENV_FILE_PATH))
        return;
    const text = readFileSync(ENV_FILE_PATH, "utf8");
    for (const line of text.split("\n")) {
        const parsed = parseEnvLine(line);
        if (!parsed)
            continue;
        const [key, value] = parsed;
        if (process.env[key] === undefined) {
            process.env[key] = value;
        }
    }
}
export function maskApiKey(key) {
    if (key.length <= 8)
        return "****";
    return `${key.slice(0, 4)}…${key.slice(-4)}`;
}
export function envStatus() {
    loadEnv();
    const apiKey = process.env.AFFIX_API_KEY?.trim() ?? "";
    return {
        env_file: ENV_FILE_PATH,
        env_file_exists: existsSync(ENV_FILE_PATH),
        api_key_set: apiKey.length > 0,
        api_key_preview: apiKey ? maskApiKey(apiKey) : null,
        api_base: process.env.AFFIX_API_BASE ?? "https://api.affix-io.com",
    };
}
