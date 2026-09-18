/* Credit: @paparichens */
import { closeSync, existsSync, mkdirSync, openSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
export function withFileLock(lockPath, fn, options) {
    const timeoutMs = options.timeoutMs ?? 10_000;
    const pollMs = options.pollMs ?? 25;
    mkdirSync(dirname(lockPath), { recursive: true });
    const start = Date.now();
    let fd;
    while (true) {
        try {
            fd = openSync(lockPath, "wx");
            writeFileSync(fd, `${process.pid}\n`);
            break;
        }
        catch (err) {
            if (err?.code !== "EEXIST") {
                throw err;
            }
            if (Date.now() - start > timeoutMs) {
                throw new Error(`lock_timeout:${lockPath}`);
            }
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, pollMs);
        }
    }
    try {
        return fn();
    }
    finally {
        try {
            closeSync(fd);
        }
        catch {
            /* ignore */
        }
        if (existsSync(lockPath)) {
            unlinkSync(lockPath);
        }
    }
}
export function atomicAppendLine(path, line) {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, line.endsWith("\n") ? line : `${line}\n`, { flag: "a" });
    renameSync(tmp, path);
}
