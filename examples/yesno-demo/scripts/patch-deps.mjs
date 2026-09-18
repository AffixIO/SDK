/* Credit: @paparichens */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ESM_PKG = {
  type: "module",
  sideEffects: false,
  browser: {
    "node:crypto": false,
  },
  node: {
    "./crypto": "./esm/cryptoNode.js",
  },
  name: "@noble/post-quantum-esm",
  version: "0.4.1",
};

function readJsonOrNull(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (!raw) {
      return null;
    }
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function packageNameFromPath(pkgPath) {
  const parts = pkgPath.split(path.sep);
  const nm = parts.lastIndexOf("node_modules");
  if (nm === -1 || nm + 1 >= parts.length) {
    return path.basename(path.dirname(pkgPath));
  }
  const scope = parts[nm + 1];
  const name = parts[nm + 2];
  if (scope.startsWith("@") && name && name !== "package.json") {
    return `${scope}/${name}`;
  }
  return scope;
}

function walkPackageJsons(dir, out = []) {
  if (!fs.existsSync(dir)) {
    return out;
  }
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkPackageJsons(full, out);
    } else if (entry.isFile() && entry.name === "package.json") {
      out.push(full);
    }
  }
  return out;
}

export function patchNoblePostQuantum(rootDir) {
  const nobleEsmPkg = path.join(
    rootDir,
    "node_modules",
    "@noble",
    "post-quantum",
    "esm",
    "package.json",
  );

  if (!fs.existsSync(nobleEsmPkg)) {
    return false;
  }

  const existing = readJsonOrNull(nobleEsmPkg);
  if (existing?.name && existing?.version) {
    return false;
  }

  const pkg = existing ? { ...existing } : { ...DEFAULT_ESM_PKG };
  pkg.name = "@noble/post-quantum-esm";
  pkg.version = "0.4.1";
  if (!pkg.type) {
    pkg.type = "module";
  }

  fs.writeFileSync(nobleEsmPkg, `${JSON.stringify(pkg, null, 2)}\n`);
  return true;
}

export function repairInvalidPackageJsons(rootDir) {
  const nm = path.join(rootDir, "node_modules");
  const files = walkPackageJsons(nm);
  let repaired = 0;

  for (const pkgPath of files) {
    const parsed = readJsonOrNull(pkgPath);
    if (parsed && typeof parsed === "object" && parsed.name && parsed.version) {
      continue;
    }

    const stub = parsed && typeof parsed === "object" ? { ...parsed } : {};
    stub.name = stub.name || packageNameFromPath(pkgPath);
    stub.version = stub.version || "0.0.0";
    fs.writeFileSync(pkgPath, `${JSON.stringify(stub, null, 2)}\n`);
    repaired += 1;
  }

  return repaired;
}

export function patchDependencies(rootDir) {
  const noble = patchNoblePostQuantum(rootDir);
  const repaired = repairInvalidPackageJsons(rootDir);
  return { noble, repaired };
}

const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const result = patchDependencies(root);
  if (result.noble) {
    console.log(
      "Patched @noble/post-quantum/esm/package.json for Node 24 compatibility.",
    );
  }
  if (result.repaired > 0) {
    console.log(
      `Repaired ${result.repaired} empty or invalid package.json file(s) in node_modules.`,
    );
  }
}
