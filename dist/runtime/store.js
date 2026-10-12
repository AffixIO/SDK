import { closeSync, fstatSync, fsyncSync, ftruncateSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { withFileLock } from "../file-lock.js";
import { canonical, clone } from "./canonical.js";

// 2.0.3 (F4): stores no longer clone or serialise the whole dataset per transaction.
// A transaction sees a copy-on-read overlay: only the records it touches are cloned, and only
// those are validated and written. A throw discards the overlay (nothing is applied).

const SCHEMA = "affix.runtime.v1";
const LOG_SCHEMA = "affix.runtime.log.v1";
const DELETED = Symbol("deleted");
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function overlayTransaction(base, update) {
  const overlay = new Map();
  const original = new Map(); // key -> canonical text of the base value, for records only read
  const read = key => {
    if (overlay.has(key)) { const v = overlay.get(key); return v === DELETED ? undefined : v; }
    if (!has(base, key)) return undefined;
    const text = canonical(base[key]);
    const copy = JSON.parse(text);
    overlay.set(key, copy);
    original.set(key, text);
    return copy;
  };
  const present = key => overlay.has(key) ? overlay.get(key) !== DELETED : has(base, key);
  const proxy = new Proxy(Object.create(null), {
    get: (_, key) => typeof key === "string" ? read(key) : undefined,
    set: (_, key, value) => { if (typeof key !== "string") return false; overlay.set(key, value); return true; },
    deleteProperty: (_, key) => { if (typeof key === "string") overlay.set(key, DELETED); return true; },
    has: (_, key) => typeof key === "string" && present(key),
    ownKeys: () => {
      const keys = new Set(Object.keys(base));
      for (const [k, v] of overlay) { if (v === DELETED) keys.delete(k); else keys.add(k); }
      return [...keys];
    },
    getOwnPropertyDescriptor: (_, key) => typeof key === "string" && present(key)
      ? { value: read(key), writable: true, enumerable: true, configurable: true } : undefined,
    defineProperty: (_, key, desc) => { if (typeof key !== "string" || !("value" in desc)) return false; overlay.set(key, desc.value); return true; },
  });
  const result = update(proxy);
  if (result?.then) throw new TypeError("Store transactions must be synchronous");
  const sets = {}; const dels = [];
  for (const [k, v] of overlay) {
    if (v === DELETED) { if (has(base, k)) dels.push(k); continue; }
    const text = canonical(v); // validates JSON data
    if (original.get(k) === text) continue; // read but unchanged: nothing to write
    sets[k] = JSON.parse(text); // detached from caller references
  }
  return { result: result === undefined ? null : clone(result), sets, dels };
}

function apply(records, sets, dels) {
  for (const k of dels) delete records[k];
  for (const k of Object.keys(sets)) records[k] = sets[k];
}

export class MemoryStore {
  #records = Object.create(null);
  transaction(update) {
    const { result, sets, dels } = overlayTransaction(this.#records, update);
    apply(this.#records, sets, dels);
    return result;
  }
}

function fsyncDir(path) {
  const directory = openSync(dirname(path), "r");
  try { fsyncSync(directory); } finally { closeSync(directory); }
}

function atomicWrite(path, text) {
  const temp = `${path}.${randomUUID()}.tmp`;
  let fd;
  try {
    fd = openSync(temp, "wx", 0o600);
    writeFileSync(fd, text);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temp, path);
    fsyncDir(path);
  } finally {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(temp); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

const statKey = st => st ? `${st.ino}:${st.size}:${st.mtimeMs}` : "none";
function statOrNull(path) { try { return statSync(path); } catch (error) { if (error.code === "ENOENT") return null; throw error; } }

/**
 * FileStore: snapshot file (the 2.0.2 format, `{ schema, records }`, plus `generation`) and an
 * append-only log `<path>.log`. Each transaction appends one fsynced line holding only the
 * records it changed; the snapshot is rewritten atomically (temp + fsync + rename) every
 * `compactEvery` transactions or when the log passes `compactBytes`. All access is under the
 * existing lock file, so several processes on one host stay consistent. 2.0.2 snapshots load
 * unchanged. Before downgrading to 2.0.2, call `compact()` so the snapshot alone is complete.
 */
export class FileStore {
  #state = null; // { records, generation, snap, logPath, logOffset, logOps }
  constructor(path, { lockTimeoutMs = 10000, compactEvery = 1000, compactBytes = 8 * 1024 * 1024 } = {}) {
    this.path = resolve(path);
    this.logPath = `${this.path}.log`;
    this.lockTimeoutMs = lockTimeoutMs;
    this.compactEvery = compactEvery;
    this.compactBytes = compactBytes;
  }
  #header(generation) { return `${JSON.stringify({ schema: LOG_SCHEMA, generation })}\n`; }
  #loadFull() {
    let data;
    try { data = JSON.parse(readFileSync(this.path, "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; data = { schema: SCHEMA, records: {} }; }
    if (data.schema !== SCHEMA || !data.records || typeof data.records !== "object" || Array.isArray(data.records)) throw new Error("Invalid runtime store");
    const records = Object.assign(Object.create(null), data.records);
    const generation = Number.isSafeInteger(data.generation) ? data.generation : 0;
    this.#state = { records, generation, snap: statKey(statOrNull(this.path)), logOffset: 0, logOps: 0, logValid: false };
    this.#replayLog(true);
  }
  // Apply log lines after logOffset. A torn final line (crash mid-append) was never acknowledged:
  // it is truncated away. A log whose header generation differs from the snapshot is stale.
  #replayLog(fromStart) {
    const st = this.#state;
    const lst = statOrNull(this.logPath);
    if (!lst) { st.logOffset = 0; st.logValid = false; return; }
    const fd = openSync(this.logPath, "r+");
    try {
      const size = fstatSync(fd).size;
      const start = fromStart ? 0 : st.logOffset;
      if (size <= start) return;
      const buf = Buffer.alloc(size - start);
      readSync(fd, buf, 0, buf.length, start);
      let pos = 0; let good = start;
      const text = buf.toString("utf8");
      let first = fromStart;
      while (pos < text.length) {
        const nl = text.indexOf("\n", pos);
        if (nl === -1) break;
        const line = text.slice(pos, nl);
        let entry;
        try { entry = JSON.parse(line); } catch { break; }
        if (first) {
          first = false;
          if (entry?.schema !== LOG_SCHEMA || entry.generation !== st.generation) { st.logValid = false; st.logOffset = size; return; }
          st.logValid = true;
        } else if (st.logValid) {
          apply(st.records, entry.s ?? {}, entry.d ?? []);
          st.logOps++;
        }
        pos = nl + 1;
        good = start + Buffer.byteLength(text.slice(0, pos));
      }
      if (good < size) ftruncateSync(fd, good);
      st.logOffset = good;
    } finally { closeSync(fd); }
  }
  #sync() {
    if (!this.#state || statKey(statOrNull(this.path)) !== this.#state.snap) return this.#loadFull();
    const lst = statOrNull(this.logPath);
    const size = lst ? lst.size : 0;
    if (size < this.#state.logOffset) return this.#loadFull();
    if (size > this.#state.logOffset) this.#replayLog(this.#state.logOffset === 0);
  }
  #append(sets, dels) {
    const st = this.#state;
    let fd;
    try {
      if (!st.logValid) {
        fd = openSync(this.logPath, "w", 0o600);
        const h = this.#header(st.generation);
        writeSync(fd, h);
        st.logOffset = Buffer.byteLength(h); st.logValid = true; st.logOps = 0;
      } else fd = openSync(this.logPath, "a", 0o600);
      const line = `${JSON.stringify({ s: sets, d: dels })}\n`;
      writeSync(fd, line);
      fsyncSync(fd);
      st.logOffset += Buffer.byteLength(line);
      st.logOps++;
    } finally { if (fd !== undefined) closeSync(fd); }
  }
  #compact() {
    const st = this.#state;
    const generation = st.generation + 1;
    atomicWrite(this.path, canonical({ schema: SCHEMA, generation, records: { ...st.records } }));
    atomicWrite(this.logPath, this.#header(generation));
    st.generation = generation;
    st.snap = statKey(statOrNull(this.path));
    st.logOffset = Buffer.byteLength(this.#header(generation)); st.logOps = 0; st.logValid = true;
  }
  transaction(update) {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    return withFileLock(`${this.path}.lock`, () => {
      this.#sync();
      const { result, sets, dels } = overlayTransaction(this.#state.records, update);
      if (dels.length || Object.keys(sets).length) {
        if (this.#state.snap === "none") this.#compact(); // first write: create the snapshot (0600)
        this.#append(sets, dels);
        apply(this.#state.records, sets, dels);
        if (this.#state.logOps >= this.compactEvery || this.#state.logOffset >= this.compactBytes) this.#compact();
      }
      return result;
    }, { timeoutMs: this.lockTimeoutMs });
  }
  /** Fold the log into the snapshot now (e.g. before a backup or a downgrade to 2.0.2). */
  compact() {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    return withFileLock(`${this.path}.lock`, () => { this.#sync(); this.#compact(); return null; }, { timeoutMs: this.lockTimeoutMs });
  }
}
