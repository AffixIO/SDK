import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { docGet, docSet, STORAGE_KEYS } from "./storage/index.js";
import { withFileLock } from "./file-lock.js";
/**
 * 2.0.3 (F5): the local proof store is bounded. It keeps the newest `max` records (default
 * 1000) and drops records older than `ttlMs` (default 7 days; 0 disables). Before 2.0.3 it kept
 * up to 50,000 proofs in one growing JSON document, so every prove() got slower. The document
 * format is unchanged (a JSON array, newest first), so existing files and custom document
 * stores keep working. Pending sync jobs live in the offline queue, not here, so pruning never
 * loses work that flush still needs.
 *
 * With the default file storage, each save appends one line to `<proofs.json>.log` instead of
 * rewriting the document; the log is folded into proofs.json (atomic temp + rename) once it
 * holds `max / 2` records. proofs.json stays a plain newest-first array, readable by 2.0.2.
 * Custom document stores keep the single-document format (bounded by the same cap and TTL).
 */
export class ProofStore {
    docs;
    max;
    key;
    ttlMs;
    clock;
    constructor(docs, max = 1000, key = STORAGE_KEYS.proofs, options = {}) {
        this.docs = docs;
        this.max = Math.max(1, max);
        this.key = key;
        this.ttlMs = options.ttlMs ?? 7 * 24 * 3600 * 1000;
        this.clock = options.clock ?? Date.now;
        const path = docs?.paths?.[key];
        this.filePath = typeof path === "string" ? path : null;
        this.logLines = null;
        this.mem = docs?.affixInternalMemory ? [] : null;
    }
    #logPath() { return `${this.filePath}.log`; }
    #readFileList() {
        let base = [];
        try { const parsed = JSON.parse(readFileSync(this.filePath, "utf8")); if (Array.isArray(parsed)) base = parsed; } catch { /* missing or unreadable: empty */ }
        let log = [];
        if (existsSync(this.#logPath())) {
            for (const line of readFileSync(this.#logPath(), "utf8").split("\n")) {
                if (!line) continue;
                try { log.push(JSON.parse(line)); } catch { /* torn tail */ }
            }
        }
        this.logLines = log.length;
        const seen = new Set(); const out = [];
        for (const p of [...log.reverse(), ...base]) {
            if (!p || seen.has(p.proof_id)) continue;
            seen.add(p.proof_id); out.push(p);
        }
        return out;
    }
    #compactFile() {
        const items = this.prune(this.#readFileList());
        mkdirSync(dirname(this.filePath), { recursive: true });
        const tmp = `${this.filePath}.${randomUUID()}.tmp`;
        const fd = openSync(tmp, "w", this.docs.fileMode ?? 0o600);
        try { writeFileSync(fd, JSON.stringify(items)); fsyncSync(fd); } finally { closeSync(fd); }
        renameSync(tmp, this.filePath);
        try { unlinkSync(this.#logPath()); } catch { /* none */ }
        this.logLines = 0;
    }
    #lock(fn) {
        mkdirSync(dirname(this.filePath), { recursive: true });
        return withFileLock(`${this.filePath}.lock`, fn);
    }
    async read() {
        if (this.mem)
            return this.mem.slice();
        if (this.filePath)
            return this.#readFileList();
        const raw = await docGet(this.docs, this.key);
        if (!raw)
            return [];
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        }
        catch {
            return [];
        }
    }
    prune(items) {
        let out = items;
        if (this.ttlMs > 0) {
            const cutoff = this.clock() - this.ttlMs;
            out = out.filter((p) => { const t = Date.parse(p?.created_at ?? ""); return !Number.isFinite(t) || t >= cutoff; });
        }
        return out.length > this.max ? out.slice(0, this.max) : out;
    }
    async write(items) {
        if (this.mem) { this.mem = this.prune(items.slice()); return; }
        if (this.filePath)
            return this.#lock(() => { try { unlinkSync(this.#logPath()); } catch { /* none */ } docSet(this.docs, this.key, JSON.stringify(this.prune(items))); this.logLines = 0; });
        await docSet(this.docs, this.key, JSON.stringify(this.prune(items)));
    }
    async save(proof) {
        if (this.mem) {
            const i = this.mem.findIndex((p) => p.proof_id === proof.proof_id);
            if (i >= 0) this.mem.splice(i, 1);
            this.mem.unshift(proof);
            if (this.mem.length > this.max) this.mem.length = this.max;
            return;
        }
        if (this.filePath) {
            return this.#lock(() => {
                if (this.logLines === null) this.#readFileList();
                appendFileSync(this.#logPath(), `${JSON.stringify(proof)}\n`, { mode: this.docs.fileMode ?? 0o600 });
                this.logLines++;
                if (this.logLines >= Math.max(1, Math.floor(this.max / 2))) this.#compactFile();
            });
        }
        const items = (await this.read()).filter((p) => p.proof_id !== proof.proof_id);
        items.unshift(proof);
        await this.write(items);
    }
    async list() {
        if (this.mem)
            return (this.mem = this.prune(this.mem)).slice();
        if (this.filePath)
            return this.#lock(() => this.prune(this.#readFileList()));
        return this.prune(await this.read());
    }
}
