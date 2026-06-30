import { readFileSync, existsSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXTRA_CA_PATH = join(packageRoot, "certs", "sectigo-r36.pem");
let caBundle;
function getCaBundle() {
    if (caBundle)
        return caBundle;
    caBundle = [...tls.rootCertificates];
    if (existsSync(EXTRA_CA_PATH)) {
        caBundle.push(readFileSync(EXTRA_CA_PATH, "utf8"));
    }
    return caBundle;
}
export async function requestJson(url, options) {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const lib = isHttps ? https : http;
    return new Promise((resolve, reject) => {
        const req = lib.request({
            protocol: parsed.protocol,
            hostname: parsed.hostname,
            port: parsed.port || (isHttps ? 443 : 80),
            path: `${parsed.pathname}${parsed.search}`,
            method: options.method ?? "GET",
            headers: options.headers,
            ca: isHttps ? getCaBundle() : undefined,
        }, (res) => {
            const chunks = [];
            res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
            res.on("end", () => {
                const text = Buffer.concat(chunks).toString("utf8");
                const status = res.statusCode ?? 0;
                resolve({
                    status,
                    ok: status >= 200 && status < 300,
                    async json() {
                        try {
                            return JSON.parse(text);
                        }
                        catch {
                            return { error: "invalid_json", raw: text };
                        }
                    },
                });
            });
        });
        req.on("error", reject);
        if (options.timeoutMs) {
            req.setTimeout(options.timeoutMs, () => {
                req.destroy(new Error("request_timeout"));
            });
        }
        if (options.body)
            req.write(options.body);
        req.end();
    });
}
