/* AffixIO Know Your Agent. Credit: @paparichens */
import { createHash } from "node:crypto";

const ANY = "*";

function isString(value) {
  return typeof value === "string" && value.length > 0;
}

function globMatch(pattern, value) {
  if (pattern === ANY) return true;
  if (!isString(pattern) || typeof value !== "string") return false;
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^\\s]*");
  return new RegExp(`^${escaped}$`).test(value);
}

function normaliseGrant(grant, index) {
  if (!grant || !isString(grant.action)) {
    throw new Error(`capability[${index}] requires a string "action"`);
  }
  return {
    action: grant.action,
    resource: isString(grant.resource) ? grant.resource : ANY,
    maxPerRun:
      Number.isInteger(grant.maxPerRun) && grant.maxPerRun > 0
        ? grant.maxPerRun
        : null,
  };
}

export class CapabilityPolicy {
  constructor(capabilities = []) {
    if (!Array.isArray(capabilities)) {
      throw new Error("capabilities must be an array");
    }
    this.grants = capabilities.map(normaliseGrant);
    this.counters = new Map();
  }

  digest() {
    const canonical = JSON.stringify(
      this.grants.map((g) => [g.action, g.resource, g.maxPerRun]),
    );
    return createHash("sha256").update(canonical).digest("hex");
  }

  list() {
    return this.grants.map((g) => ({ ...g }));
  }

  decide({ action, resource } = {}) {
    if (!isString(action)) {
      return { allow: false, reason: "missing_action", matched: null };
    }
    const target = isString(resource) ? resource : ANY;
    const grant = this.grants.find(
      (g) => globMatch(g.action, action) && globMatch(g.resource, target),
    );
    if (!grant) {
      return { allow: false, reason: "no_matching_grant", matched: null };
    }
    if (grant.maxPerRun !== null) {
      const key = `${grant.action}|${grant.resource}`;
      const used = this.counters.get(key) ?? 0;
      if (used >= grant.maxPerRun) {
        return {
          allow: false,
          reason: "rate_limit_exceeded",
          matched: { ...grant },
        };
      }
      this.counters.set(key, used + 1);
    }
    return { allow: true, reason: "granted", matched: { ...grant } };
  }

  reset() {
    this.counters.clear();
  }
}
