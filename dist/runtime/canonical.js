export function canonical(value) {
  const seen = new Set();
  function visit(item) {
    if (item === null || typeof item === "string" || typeof item === "boolean") return item;
    if (typeof item === "number" && Number.isFinite(item)) return item;
    if (typeof item !== "object" || seen.has(item)) throw new TypeError("Expected acyclic JSON data");
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) {
      throw new TypeError("Expected a plain JSON object");
    }
    seen.add(item);
    const out = Array.isArray(item) ? item.map(visit) : Object.fromEntries(Object.keys(item).sort().map(key => [key, visit(item[key])]));
    seen.delete(item);
    return out;
  }
  return JSON.stringify(visit(value));
}

export const clone = value => JSON.parse(canonical(value));

export function required(value, name) {
  if (typeof value !== "string" || !value.trim() || value.length > 512) throw new TypeError(`Invalid ${name}`);
  return value;
}

export function positive(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`Invalid ${name}`);
  return value;
}
