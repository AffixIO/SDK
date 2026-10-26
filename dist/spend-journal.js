/* Credit: @paparichens */
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { withFileLock } from "./file-lock.js";
import { canonicalLocalPayload } from "./local-signing.js";

const HEAD_NAME = "spend-head.json";
const JOURNAL_NAME = "spend-journal.jsonl";
const LOCK_NAME = "spend-journal.lock";

function eventCanonical(event) {
    return canonicalLocalPayload({
        seq: event.seq,
        prev_hash: event.prev_hash,
        gate_id: event.gate_id,
        proof_digest: event.proof_digest,
        action: event.action,
        ts: event.ts,
        max_uses: event.max_uses,
    });
}

function hashEvent(event) {
    return createHash("sha256").update(eventCanonical(event), "utf8").digest("hex");
}

function loadKeys(keysPath) {
    // 2.0.3: accepts the key object itself (supplied keys are never written to disk) or a path.
    const raw = keysPath && typeof keysPath === "object" ? keysPath : JSON.parse(readFileSync(keysPath, "utf8"));
    return {
        publicKeyB64: raw.public_key_b64,
        secretKeyB64: raw.secret_key_b64,
        keyId: raw.key_id,
    };
}

export class SpendJournal {
    baseDir;
    keysPath;
    constructor(baseDir, keysPath) {
        this.baseDir = baseDir;
        this.keysPath = keysPath;
    }
    journalPath() {
        return join(this.baseDir, JOURNAL_NAME);
    }
    headPath() {
        return join(this.baseDir, HEAD_NAME);
    }
    lockPath() {
        return join(this.baseDir, LOCK_NAME);
    }
    ensureDir() {
        // 2.0.3 (H3): an SDK without operatorBaseDir keeps no spend journal; single-use code
        // gates need durable storage, so this fails loudly instead of writing to the CWD.
        if (!this.baseDir)
            throw new Error("spend_journal_requires_operatorBaseDir: pass operatorBaseDir (or spendDir) to use single-use code gates");
        mkdirSync(this.baseDir, { recursive: true, mode: 0o700 });
    }
    readHead() {
        this.ensureDir();
        const path = this.headPath();
        if (!existsSync(path)) {
            return { seq: 0, last_hash: "0".repeat(64), updated_at: null };
        }
        return JSON.parse(readFileSync(path, "utf8"));
    }
    writeHead(head) {
        this.ensureDir();
        const path = this.headPath();
        writeFileSync(path, `${JSON.stringify({ ...head, updated_at: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
        chmodSync(path, 0o600);
    }
    readEvents() {
        this.ensureDir();
        const path = this.journalPath();
        if (!existsSync(path))
            return [];
        return readFileSync(path, "utf8")
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => JSON.parse(line));
    }
    verifyChain(events) {
        const keys = loadKeys(this.keysPath);
        const publicKey = Buffer.from(keys.publicKeyB64, "base64");
        let prev = "0".repeat(64);
        for (const row of events) {
            if (row.prev_hash !== prev) {
                return { ok: false, error: "chain_break", seq: row.seq };
            }
            const canonical = eventCanonical(row);
            const digest = hashEvent(row);
            if (digest !== row.event_hash) {
                return { ok: false, error: "event_hash_mismatch", seq: row.seq };
            }
            const sig = Buffer.from(row.mldsa_signature_b64, "base64");
            const valid = ml_dsa65.verify(publicKey, Buffer.from(canonical, "utf8"), sig);
            if (!valid) {
                return { ok: false, error: "signature_invalid", seq: row.seq };
            }
            prev = row.event_hash;
        }
        return { ok: true, last_hash: prev, count: events.length };
    }
    verifyIntegrity() {
        const events = this.readEvents();
        const head = this.readHead();
        const chain = this.verifyChain(events);
        if (!chain.ok)
            return chain;
        if (events.length > 0 && head.last_hash !== chain.last_hash) {
            return { ok: false, error: "head_mismatch" };
        }
        if (head.seq !== events.length) {
            return { ok: false, error: "seq_mismatch" };
        }
        return { ok: true, seq: head.seq, last_hash: head.last_hash, count: events.length };
    }
    countUses(gateId, proofDigest) {
        const events = this.readEvents();
        const chain = this.verifyChain(events);
        if (!chain.ok) {
            throw new Error(`spend_journal_corrupt:${chain.error}`);
        }
        let uses = 0;
        for (const row of events) {
            if (row.gate_id === gateId && row.proof_digest === proofDigest && row.action === "consume") {
                uses += 1;
            }
        }
        return uses;
    }
    checkAdmission(gateId, proofDigest, maxUses) {
        const uses = this.countUses(gateId, proofDigest);
        if (maxUses === 0) {
            return { admitted: true, uses, remaining: null };
        }
        if (uses >= maxUses) {
            return { admitted: false, uses, remaining: 0, reason: "max_uses_exceeded" };
        }
        return { admitted: true, uses, remaining: maxUses - uses };
    }
    appendEvent(input) {
        return withFileLock(this.lockPath(), () => {
            const events = this.readEvents();
            const chain = this.verifyChain(events);
            if (!chain.ok) {
                throw new Error(`spend_journal_corrupt:${chain.error}`);
            }
            const head = this.readHead();
            const seq = head.seq + 1;
            const keys = loadKeys(this.keysPath);
            const secretKey = Buffer.from(keys.secretKeyB64, "base64");
            const event = {
                seq,
                prev_hash: head.last_hash,
                gate_id: input.gateId,
                proof_digest: input.proofDigest,
                action: input.action,
                max_uses: input.maxUses,
                ts: new Date().toISOString(),
            };
            event.event_hash = hashEvent(event);
            const canonical = eventCanonical(event);
            const signature = ml_dsa65.sign(secretKey, Buffer.from(canonical, "utf8"));
            event.mldsa_signature_b64 = Buffer.from(signature).toString("base64");
            event.key_id = keys.keyId;
            appendFileSync(this.journalPath(), `${JSON.stringify(event)}\n`, { mode: 0o600 });
            chmodSync(this.journalPath(), 0o600);
            this.writeHead({ seq, last_hash: event.event_hash });
            return event;
        });
    }
    consume(gateId, proofDigest, maxUses) {
        const check = this.checkAdmission(gateId, proofDigest, maxUses);
        if (!check.admitted) {
            return { ...check, consumed: false };
        }
        this.appendEvent({
            gateId,
            proofDigest,
            action: "consume",
            maxUses,
        });
        const uses = check.uses + 1;
        return {
            admitted: true,
            consumed: true,
            uses,
            remaining: maxUses === 0 ? null : Math.max(0, maxUses - uses),
        };
    }
    status() {
        const integrity = this.verifyIntegrity();
        const head = this.readHead();
        return {
            integrity,
            head,
            journal_path: this.journalPath(),
        };
    }
}
