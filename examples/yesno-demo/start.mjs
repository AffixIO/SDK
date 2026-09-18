/* Credit: @paparichens */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { patchDependencies } from "./scripts/patch-deps.mjs";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const patched = patchDependencies(rootDir);

if (patched.noble) {
  console.log(
    "Patched @noble/post-quantum/esm/package.json for Node 24 compatibility.",
  );
}
if (patched.repaired > 0) {
  console.log(
    `Repaired ${patched.repaired} empty or invalid package.json file(s).`,
  );
}

await import("./server.mjs");
