/* Credit: @paparichens */
import { closeSync, existsSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

// 2.0.3 (H2): the lock file records { pid, host, procStart, acquiredAt, leaseMs, token }.
// A stale lock is broken when (same host) the pid is gone or now belongs to a different process
// (start time differs), or (other host, or an unreadable/half-written lock) its lease has expired.
// A live holder on this host is never broken. Breaking renames the lock aside and checks it is
// still the one judged stale; if another process won the race, its lock is put back.
const HOST = hostname();
function procStart(pid) {
    try {
        const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
        return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] ?? null; // field 22: starttime
    }
    catch {
        return null;
    }
}
const MY_START = procStart(process.pid);
function pidAlive(pid) {
    try { process.kill(pid, 0); return true; }
    catch (err) { return err?.code === "EPERM"; }
}
function readLock(lockPath) {
    try { return readFileSync(lockPath, "utf8"); } catch { return null; }
}
/** Why a lock is stale, or null if it must be respected. Exported for tests. */
export function lockStaleReason(text, mtimeMs, nowMs = Date.now(), defaultLeaseMs = 30_000) {
    let info = null;
    try { info = JSON.parse(text); } catch { /* legacy "pid\n" lock or torn write */ }
    if (!info || typeof info !== "object") {
        const pid = Number.parseInt(String(text ?? "").trim(), 10);
        if (Number.isSafeInteger(pid) && pid > 0 && !pidAlive(pid) && nowMs - mtimeMs > 1000)
            return "legacy_lock_dead_pid";
        return nowMs - mtimeMs > defaultLeaseMs ? "unreadable_lock_lease_expired" : null;
    }
    if (info.host === HOST && Number.isSafeInteger(info.pid)) {
        if (!pidAlive(info.pid))
            return "holder_dead";
        const start = procStart(info.pid);
        if (info.procStart && start && start !== info.procStart)
            return "holder_pid_reused";
        return null; // live holder on this host: never broken
    }
    const lease = Number.isFinite(info.leaseMs) ? info.leaseMs : defaultLeaseMs;
    return nowMs - (Number(info.acquiredAt) || mtimeMs) > lease ? "lease_expired" : null;
}
function tryBreak(lockPath, leaseMs) {
    let st;
    try { st = statSync(lockPath); } catch { return true; }
    const text = readLock(lockPath);
    if (text === null) return true;
    const reason = lockStaleReason(text, st.mtimeMs, Date.now(), leaseMs);
    if (!reason) return false;
    const aside = `${lockPath}.stale.${randomUUID()}`;
    try { renameSync(lockPath, aside); } catch { return true; }
    if (readLock(aside) === text) {
        unlinkSync(aside);
        process.emitWarning?.(`AffixIO: broke stale lock ${lockPath} (${reason})`, { code: "AFFIXIO_STALE_LOCK_BROKEN" });
    }
    else {
        try { linkSync(aside, lockPath); } catch { /* a newer lock exists; ours was not stale */ }
        unlinkSync(aside);
    }
    return true;
}

export function withFileLock(lockPath, fn, options = {}) {
    const timeoutMs = options.timeoutMs ?? 10_000;
    const pollMs = options.pollMs ?? 25;
    const leaseMs = options.leaseMs ?? 30_000;
    mkdirSync(dirname(lockPath), { recursive: true });
    const start = Date.now();
    const token = randomUUID();
    const body = JSON.stringify({ pid: process.pid, host: HOST, procStart: MY_START, acquiredAt: Date.now(), leaseMs, token });
    let fd;
    while (true) {
        // Created atomically: the full body is written to a temp file, then hard-linked into
        // place (fails with EEXIST if held). A crash can never leave an empty or torn lock.
        const tmp = `${lockPath}.${process.pid}.${token}.tmp`;
        try {
            writeFileSync(tmp, `${body}\n`, { mode: 0o600 });
            try { linkSync(tmp, lockPath); } finally { try { unlinkSync(tmp); } catch { /* ignore */ } }
            fd = openSync(lockPath, "r");
            break;
        }
        catch (err) {
            if (err?.code !== "EEXIST")
                throw err;
            if (tryBreak(lockPath, leaseMs))
                continue;
            if (Date.now() - start > timeoutMs)
                throw new Error(`lock_timeout:${lockPath}`);
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, pollMs);
        }
    }
    try {
        return fn();
    }
    finally {
        try { closeSync(fd); } catch { /* ignore */ }
        // Only remove the lock if it is still ours.
        if (readLock(lockPath)?.includes(token)) {
            try { unlinkSync(lockPath); } catch { /* ignore */ }
        }
    }
}

export function atomicAppendLine(path, line) {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, line.endsWith("\n") ? line : `${line}\n`, { flag: "a" });
    renameSync(tmp, path);
}
