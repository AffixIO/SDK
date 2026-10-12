import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { resolveSidecarPath } from "./spent-store.js";
function resolveBasePath(opts, codeId) {
    if (!opts.path)
        return null;
    const raw = opts.path.trim();
    if (!raw)
        return null;
    const ext = extname(raw).toLowerCase();
    if (ext === ".svg" || ext === ".png" || ext === ".json") {
        return raw.replace(/\.(svg|png|json)$/i, "");
    }
    if (opts.basename) {
        return join(raw, opts.basename);
    }
    return join(raw, codeId);
}
export function saveCodeAssets(code, rendered, opts) {
    const files = { content: code.content };
    const base = resolveBasePath(opts ?? {}, code.header.code_id);
    if (!base)
        return files;
    const dir = dirname(base);
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    if (rendered.svg) {
        const svgPath = `${base}.svg`;
        writeFileSync(svgPath, rendered.svg, { encoding: "utf8", mode: 0o600 });
        files.svg = svgPath;
    }
    if (rendered.png) {
        const pngPath = `${base}.png`;
        writeFileSync(pngPath, rendered.png, { mode: 0o600 });
        files.png = pngPath;
    }
    const writeSidecar = opts?.sidecar ?? code.carrier_mode === "compact";
    if (writeSidecar) {
        const sidecarPath = resolveSidecarPath(`${base}.zk.json`, code.header.code_id);
        const sidecarDir = dirname(sidecarPath);
        if (!existsSync(sidecarDir))
            mkdirSync(sidecarDir, { recursive: true });
        writeFileSync(sidecarPath, JSON.stringify({
            version: 1,
            code_id: code.header.code_id,
            carrier_mode: code.carrier_mode,
            content: code.content,
            carrier: code.carrier,
            link: code.link,
            header: code.header,
            prove: {
                proof_id: code.prove.proof_id,
                circuit_id: code.prove.circuit_id,
                proof: code.prove.proof,
                proof_digest: code.prove.proof_digest,
                decision: code.prove.decision,
                valid: code.prove.valid,
            },
            kind: code.kind,
            symbology: code.symbology,
            saved_at: new Date().toISOString(),
        }, null, 2) + "\n", { mode: 0o600 });
        files.sidecar = sidecarPath;
    }
    return files;
}
export function loadSidecar(path) {
    if (!existsSync(path))
        return null;
    try {
        return JSON.parse(readFileSync(path, "utf8"));
    }
    catch {
        return null;
    }
}
