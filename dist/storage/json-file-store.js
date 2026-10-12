import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
function atomicWrite(path, value, mode = 0o600) {
    // 2.0.3 (H3): SDK data files are 0600 in a 0700 directory.
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, value, { mode });
    chmodSync(tmp, mode);
    renameSync(tmp, path);
}
/**
 * Maps storage keys to local JSON files (default Affix behaviour).
 */
export class PathMappedJsonStore {
    paths;
    fileMode;
    constructor(paths, fileMode) {
        this.paths = paths;
        this.fileMode = fileMode;
    }
    get(key) {
        const path = this.paths[key];
        if (!path || !existsSync(path))
            return null;
        try {
            return readFileSync(path, "utf8");
        }
        catch {
            return null;
        }
    }
    set(key, value) {
        const path = this.paths[key];
        if (!path)
            throw new Error(`unknown_storage_key:${key}`);
        atomicWrite(path, value, this.fileMode);
    }
    delete(key) {
        const path = this.paths[key];
        if (!path || !existsSync(path))
            return;
        unlinkSync(path);
    }
}
/** Single JSON file as one document key (value is the whole file body). */
export class JsonFileDocumentStore {
    path;
    fileMode;
    constructor(path, fileMode) {
        this.path = path;
        this.fileMode = fileMode;
    }
    get(_key) {
        if (!existsSync(this.path))
            return null;
        try {
            return readFileSync(this.path, "utf8");
        }
        catch {
            return null;
        }
    }
    set(_key, value) {
        atomicWrite(this.path, value, this.fileMode);
    }
    delete(_key) {
        if (!existsSync(this.path))
            return;
        unlinkSync(this.path);
    }
}
export function createDefaultJsonDocumentStore(paths) {
    return new PathMappedJsonStore({
        proofs: paths.proofs,
        "offline-queue": paths.offlineQueue,
        "code-uses": paths.codeUses,
        licence: paths.licence,
        stats: paths.stats,
    });
}
