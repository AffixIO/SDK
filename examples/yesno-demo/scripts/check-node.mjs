/* Credit: @paparichens */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { patchDependencies } from "./patch-deps.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const patched = patchDependencies(root);

const [major, minor] = process.version.slice(1).split(".").map(Number);

if (major < 20 || (major === 20 && minor < 19)) {
  console.error(
    `Node ${process.version} is too old. Use Node 20.19+ (LTS recommended).`,
  );
  process.exit(1);
}

if (major >= 24) {
  console.warn(
    `Node ${process.version} detected. Dependency patches applied for compatibility.`,
  );
}

if (patched.repaired > 0) {
  console.warn(
    `Repaired ${patched.repaired} invalid package.json file(s). Prefer a clean install:`,
  );
  console.warn("  rm -rf node_modules package-lock.json && npm install");
}
