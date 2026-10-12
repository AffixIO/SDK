import { canonical, clone, positive, required } from "./canonical.js";
import { digest } from "./budget.js";

export function validatePolicy(policy) {
  required(policy.id, "policy id");
  required(policy.version, "policy version");
  if (!["all", "any"].includes(policy.mode) || !Array.isArray(policy.rules) || !policy.rules.length) throw new TypeError("Policy needs all/any rules");
  const ids = new Set();
  for (const rule of policy.rules) {
    required(rule.source, "source id");
    if (ids.has(rule.source)) throw new TypeError("Each source must appear once");
    ids.add(rule.source);
    positive(rule.maxAgeMs, "source maximum age");
    if (!["eq", "gte", "lte", "includes", "truthy"].includes(rule.operator)) throw new TypeError("Unsupported operator");
    if (rule.operator !== "truthy" && rule.value === undefined) throw new TypeError("Rule value required");
    if (["gte", "lte"].includes(rule.operator) && typeof rule.value !== "number") throw new TypeError("Numeric rule value required");
  }
  canonical(policy);
  return policy;
}

function matches(actual, rule) {
  switch (rule.operator) {
    case "eq": return canonical(actual) === canonical(rule.value);
    case "gte": return typeof actual === "number" && actual >= rule.value;
    case "lte": return typeof actual === "number" && actual <= rule.value;
    case "includes": return Array.isArray(actual) && actual.some(item => canonical(item) === canonical(rule.value));
    case "truthy": return actual === true;
  }
}

export function evaluatePolicy(policy, observations, { now = Date.now(), input } = {}) {
  validatePolicy(policy);
  const seen = new Set();
  for (const observation of observations) {
    if (seen.has(observation.source)) throw new Error("Duplicate source observation");
    seen.add(observation.source);
  }
  const checks = policy.rules.map(rule => {
    const item = observations.find(value => value.source === rule.source);
    const validTime = item && Number.isSafeInteger(item.observedAt) && item.observedAt <= now;
    const validUntil = validTime ? Math.min(item.observedAt + rule.maxAgeMs, item.expiresAt ?? Infinity) : now;
    let reason = "available";
    if (!item || item.status !== "ok" || item.value === undefined) reason = "source_unavailable";
    else if (!validTime || !Number.isFinite(validUntil) || validUntil <= now) reason = "source_stale";
    const available = reason === "available";
    return { source: rule.source, outcome: available ? (matches(item.value, rule) ? "pass" : "fail") : "review", reason,
      fingerprint: item?.fingerprint ?? (available ? digest(item.value) : null), observedAt: item?.observedAt ?? null,
      validUntil: Number.isFinite(validUntil) ? validUntil : now };
  });
  let decision;
  if (checks.some(check => check.outcome === "review")) decision = "review";
  else decision = (policy.mode === "all" ? checks.every(check => check.outcome === "pass") : checks.some(check => check.outcome === "pass")) ? "allow" : "deny";
  if (decision === "allow" && policy.requireReview === true) decision = "review";
  return { schema: "affix.decision.v1", decision, policyId: policy.id, policyVersion: policy.version, policyDigest: digest(policy),
    inputDigest: input === undefined ? null : digest(input), evaluatedAt: now, validUntil: Math.min(...checks.map(check => check.validUntil)), checks };
}

export class DecisionPipeline {
  constructor({ sources, clock = Date.now, timeoutMs = 10000 }) {
    this.sources = sources; this.clock = clock; this.timeoutMs = positive(timeoutMs, "timeout");
  }
  async collect(policy, input, { signal } = {}) {
    validatePolicy(policy);
    const observations = [];
    for (const rule of policy.rules) {
      signal?.throwIfAborted();
      const source = this.sources[rule.source];
      if (typeof source !== "function") { observations.push({ source: rule.source, status: "error", observedAt: this.clock() }); continue; }
      const controller = new AbortController();
      let timer, onAbort;
      try {
        const timeout = new Promise((_, reject) => {
          const stop = reason => { controller.abort(reason); reject(new Error("Source request stopped")); };
          timer = setTimeout(() => stop("timeout"), this.timeoutMs);
          onAbort = () => stop(signal.reason);
          signal?.addEventListener("abort", onAbort, { once: true });
        });
        const result = await Promise.race([Promise.resolve().then(() => source(clone(input), { signal: controller.signal })), timeout]);
        observations.push(clone({ ...result, source: rule.source, status: "ok", observedAt: result.observedAt ?? this.clock(), fingerprint: digest(result.value) }));
      } catch {
        signal?.throwIfAborted();
        observations.push({ source: rule.source, status: "error", observedAt: this.clock() });
      } finally { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); }
    }
    return observations;
  }
  async evaluate(policy, input, options) {
    const snapshot = clone(input);
    const policySnapshot = clone(policy);
    return evaluatePolicy(policySnapshot, await this.collect(policySnapshot, snapshot, options), { now: this.clock(), input: snapshot });
  }
  async prove(sdk, policy, input, { requestId, ...options } = {}) {
    required(requestId, "request id");
    const policySnapshot = clone(policy);
    const result = await this.evaluate(policySnapshot, input, options);
    const binding = { schema: "affix.decision-binding.v1", policy: policySnapshot,
      input_digest: result.inputDigest, decision_digest: digest(result) };
    if (result.decision === "review") return { result, proof: null, binding };
    const proof = await sdk.prove({ circuitId: "simple_yesno", proofMode: "hmac", mode: "offline",
      decision: result.decision === "allow" ? "yes" : "no", policy: clone(binding), request_id: requestId,
      fields: { claim: result.decision, required: "allow" }, meta: { decision_digest: digest(result), policy_digest: result.policyDigest, input_digest: result.inputDigest } });
    return { result, proof, binding };
  }
}

export function dataCheckSource(adapter, queryFor, { clock = Date.now } = {}) {
  if (typeof adapter?.lookup !== "function" || typeof queryFor !== "function") throw new TypeError("A data-check adapter and query mapper are required");
  return async (input, { signal } = {}) => {
    signal?.throwIfAborted();
    const result = await adapter.lookup(queryFor(input));
    signal?.throwIfAborted();
    if (!result || typeof result.pass !== "boolean") throw new Error("Data-check source unavailable");
    return { value: result.pass, observedAt: clock() };
  };
}

export function replayPolicy(policy, cases) {
  return cases.map(item => {
    required(item.id, "replay case id");
    if (!Number.isSafeInteger(item.at)) throw new TypeError("Replay cases require a fixed timestamp");
    return { id: item.id, result: evaluatePolicy(policy, item.observations, { now: item.at, input: item.input }), previous: item.previous ?? null };
  });
}

export async function* watchSources(pipeline, policy, input, { intervalMs = 30000, signal } = {}) {
  positive(intervalMs, "watch interval");
  let previous;
  while (!signal?.aborted) {
    const result = await pipeline.evaluate(policy, input, { signal });
    const signature = digest(result.checks.map(({ source, fingerprint, outcome }) => ({ source, fingerprint, outcome })));
    yield { result, changed: previous !== undefined && previous !== signature };
    previous = signature;
    await new Promise(resolve => {
      const stop = () => { clearTimeout(timer); signal?.removeEventListener("abort", stop); resolve(); };
      const timer = setTimeout(stop, intervalMs);
      signal?.addEventListener("abort", stop, { once: true });
      if (signal?.aborted) stop();
    });
  }
}
