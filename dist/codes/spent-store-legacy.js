import { join } from "node:path";

export function resolveSidecarPath(basePath, codeId) {
    if (basePath.endsWith(".zk.json"))
        return basePath;
    if (basePath.endsWith(".svg") || basePath.endsWith(".png")) {
        return basePath.replace(/\.(svg|png)$/i, ".zk.json");
    }
    return join(basePath, `${codeId}.zk.json`);
}
