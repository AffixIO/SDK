#!/usr/bin/env node
/* Credit: @paparichens
 * Sticky MCP connect helpers for affixio / affix-sdk CLI.
 * Config-only: no API keys, no /oauth/register.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

export const DEFAULT_MCP_URL = "https://www.affix-io.com/mcp/";
export const SERVER_NAMES = ["affixio", "affix"];
export const PRIMARY_SERVER_NAME = "affixio";

function validateMcpUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("MCP URL must be HTTPS without embedded credentials, query parameters or fragments");
  }
  return url.href;
}

function isAffixMcpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["affix-io.com", "www.affix-io.com"].includes(url.hostname) && /^\/mcp\/?$/.test(url.pathname);
  } catch { return false; }
}

/**
 * @param {string[]} argv process.argv slice starting after "mcp"
 */
export function parseMcpArgs(argv) {
  const flags = {
    dryRun: false,
    project: false,
    open: false,
    stdio: false,
    url: DEFAULT_MCP_URL,
  };
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") flags.dryRun = true;
    else if (a === "--project") flags.project = true;
    else if (a === "--open") flags.open = true;
    else if (a === "--stdio") flags.stdio = true;
    else if (a === "--url") {
      const v = argv[++i];
      if (!v || v.startsWith("-")) throw new Error("--url requires a value");
      flags.url = v;
    }
    else if (a === "--help" || a === "-h") positionals.push("help");
    else if (a.startsWith("-")) throw new Error(`Unknown flag: ${a}`);
    else positionals.push(a);
  }
  flags.url = validateMcpUrl(flags.url);
  const sub = positionals[0] ?? "install";
  return { sub, flags, positionals };
}

function expandHome(p) {
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function claudeDesktopPath() {
  const platform = process.platform;
  if (platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  if (platform === "win32") {
    const appdata = process.env.APPDATA;
    if (appdata) return path.join(appdata, "Claude", "claude_desktop_config.json");
    return null;
  }
  // Linux / other
  return path.join(os.homedir(), ".config", "Claude", "claude_desktop_config.json");
}

/**
 * Known Claude Code paths — only emit if the file or parent dir already exists.
 * Do not invent new locations.
 */
function claudeCodeCandidates() {
  const home = os.homedir();
  return [
    path.join(home, ".claude.json"),
    path.join(home, ".config", "claude", "mcp.json"),
    path.join(process.cwd(), ".mcp.json"),
  ];
}

/**
 * @typedef {{ id: string, label: string, path: string, createIfMissing: boolean, alwaysStdio?: boolean }} Target
 */

/**
 * @param {{ project?: boolean }} opts
 * @returns {Target[]}
 */
export function discoverTargets(opts = {}) {
  /** @type {Target[]} */
  const targets = [];
  const cursorUser = path.join(os.homedir(), ".cursor", "mcp.json");
  targets.push({
    id: "cursor-user",
    label: "Cursor (user)",
    path: cursorUser,
    createIfMissing: true,
  });

  const cwdCursorDir = path.join(process.cwd(), ".cursor");
  const cwdCursorMcp = path.join(cwdCursorDir, "mcp.json");
  const wantProject = Boolean(opts.project) || fs.existsSync(cwdCursorDir);
  if (wantProject) {
    targets.push({
      id: "cursor-project",
      label: "Cursor (project)",
      path: cwdCursorMcp,
      createIfMissing: Boolean(opts.project) || fs.existsSync(cwdCursorDir),
    });
  }

  const claudePath = claudeDesktopPath();
  if (claudePath && (fs.existsSync(claudePath) || fs.existsSync(path.dirname(claudePath)))) {
    targets.push({
      id: "claude-desktop",
      label: "Claude Desktop",
      path: claudePath,
      // Claude Desktop historically stdio-only; use mcp-remote unless file already has url entries
      createIfMissing: false,
      alwaysStdio: false,
    });
  }

  for (const p of claudeCodeCandidates()) {
    if (fs.existsSync(p)) {
      targets.push({
        id: `claude-code:${path.basename(p)}`,
        label: `Claude Code (${path.basename(p)})`,
        path: p,
        createIfMissing: false,
      });
    }
  }

  return targets;
}

function detectServersRoot(doc) {
  if (!doc || typeof doc !== "object") return { rootKey: "mcpServers", servers: {} };
  if (doc.mcpServers && typeof doc.mcpServers === "object") {
    return { rootKey: "mcpServers", servers: { ...doc.mcpServers } };
  }
  // VS Code / some clients
  if (doc.servers && typeof doc.servers === "object") {
    return { rootKey: "servers", servers: { ...doc.servers } };
  }
  return { rootKey: "mcpServers", servers: {} };
}

function filePrefersUrl(servers) {
  const values = Object.values(servers || {});
  if (values.length === 0) return true; // Cursor default: prefer url
  return values.some((s) => s && typeof s === "object" && typeof s.url === "string");
}

/**
 * @param {{ url: string, forceStdio?: boolean, preferUrl?: boolean }} opts
 */
export function buildServerEntry(opts) {
  const url = validateMcpUrl(opts.url || DEFAULT_MCP_URL);
  const useUrl = opts.forceStdio ? false : (opts.preferUrl !== false);
  if (useUrl) {
    return { url };
  }
  return {
    command: "npx",
    args: ["-y", "mcp-remote", url],
  };
}

export function findAffixEntry(servers) {
  for (const name of SERVER_NAMES) {
    if (servers && servers[name]) return { name, entry: servers[name] };
  }
  // Also match by url / mcp-remote args
  for (const [name, entry] of Object.entries(servers || {})) {
    if (!entry || typeof entry !== "object") continue;
    if (typeof entry.url === "string" && isAffixMcpUrl(entry.url)) {
      return { name, entry };
    }
    if (Array.isArray(entry.args) && entry.args.some((a) => typeof a === "string" && isAffixMcpUrl(a))) {
      return { name, entry };
    }
  }
  return null;
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return { exists: false, doc: {}, raw: "" };
  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw.trim()) return { exists: true, doc: {}, raw };
  try {
    const doc = JSON.parse(raw);
    if (!doc || Array.isArray(doc) || typeof doc !== "object") throw new Error("Expected a configuration object");
    for (const key of ["mcpServers", "servers"]) {
      if (doc[key] !== undefined && (!doc[key] || Array.isArray(doc[key]) || typeof doc[key] !== "object")) throw new Error(`Invalid ${key} object`);
    }
    return { exists: true, doc, raw };
  } catch (err) {
    throw new Error(`Invalid JSON in ${filePath}: ${err instanceof Error ? err.message : err}`);
  }
}

function writeJsonPretty(filePath, doc) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { mode: 0o755, recursive: true });
  const body = `${JSON.stringify(doc, null, 2)}\n`;
  fs.writeFileSync(filePath, body, { encoding: "utf8", mode: 0o644 });
}

/**
 * @param {Target} target
 * @param {{ url: string, forceStdio?: boolean, dryRun?: boolean }} opts
 */
export function planInstall(target, opts) {
  const { exists, doc } = readJsonFile(target.path);
  if (!exists && !target.createIfMissing) {
    return { target, action: "skip", reason: "config not present (will not create)" };
  }
  const { rootKey, servers } = detectServersRoot(doc);
  const preferUrl = opts.forceStdio
    ? false
    : (target.alwaysStdio ? false : filePrefersUrl(servers));
  const entry = buildServerEntry({
    url: opts.url,
    forceStdio: opts.forceStdio || target.alwaysStdio,
    preferUrl,
  });
  const existing = findAffixEntry(servers);
  const name = existing?.name ?? PRIMARY_SERVER_NAME;
  // Drop alternate Affix names so we keep a single entry
  const nextServers = { ...servers };
  for (const alt of SERVER_NAMES) {
    if (alt !== name) delete nextServers[alt];
  }
  nextServers[name] = entry;
  const nextDoc = { ...(doc && typeof doc === "object" ? doc : {}), [rootKey]: nextServers };
  const shape = entry.url ? "url" : "stdio (mcp-remote)";
  const action = existing ? "update" : "add";
  return {
    target,
    action,
    name,
    shape,
    path: target.path,
    entry,
    nextDoc,
    willCreate: !exists,
  };
}

/**
 * @param {Target} target
 */
export function planRemove(target) {
  if (!fs.existsSync(target.path)) {
    return { target, action: "skip", reason: "file missing" };
  }
  const { doc } = readJsonFile(target.path);
  const { rootKey, servers } = detectServersRoot(doc);
  const found = findAffixEntry(servers);
  if (!found) {
    return { target, action: "skip", reason: "no Affix entry" };
  }
  const nextServers = { ...servers };
  delete nextServers[found.name];
  // Also remove other Affix aliases
  for (const alt of SERVER_NAMES) delete nextServers[alt];
  const nextDoc = { ...(doc && typeof doc === "object" ? doc : {}), [rootKey]: nextServers };
  return {
    target,
    action: "remove",
    name: found.name,
    path: target.path,
    nextDoc,
  };
}

/**
 * @param {Target} target
 */
export function statusOf(target) {
  if (!fs.existsSync(target.path)) {
    return { target, present: false, detail: "file missing" };
  }
  try {
    const { doc } = readJsonFile(target.path);
    const { servers } = detectServersRoot(doc);
    const found = findAffixEntry(servers);
    if (!found) return { target, present: false, detail: "no Affix entry" };
    const shape = found.entry.url
      ? `url → ${found.entry.url}`
      : `stdio → ${(found.entry.command || "?")} ${(found.entry.args || []).join(" ")}`;
    return { target, present: true, name: found.name, detail: shape };
  } catch (err) {
    return { target, present: false, detail: `error: ${err instanceof Error ? err.message : err}` };
  }
}

function printSnippet(url, forceStdio) {
  const urlEntry = { mcpServers: { affixio: { url } } };
  const stdioEntry = {
    mcpServers: {
      affixio: {
        command: "npx",
        args: ["-y", "mcp-remote", url],
      },
    },
  };
  console.log("Remote URL:");
  console.log(`  ${url}`);
  console.log("");
  console.log("Cursor / URL-capable clients:");
  console.log(JSON.stringify(urlEntry, null, 2));
  console.log("");
  console.log("stdio fallback (mcp-remote):");
  console.log(JSON.stringify(stdioEntry, null, 2));
  if (forceStdio) {
    console.log("");
    console.log("(forced --stdio shape shown above as preferred)");
  }
}

function openBrowser(url) {
  const platform = process.platform;
  let cmd;
  let args;
  if (platform === "darwin") {
    cmd = "open";
    args = [url];
  } else if (platform === "win32") {
    cmd = "cmd";
    args = ["/c", "start", "", url];
  } else {
    cmd = "xdg-open";
    args = [url];
  }
  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function printHelp() {
  console.log(`affixio mcp — sticky MCP connect (Cursor-style)

Usage:
  npx affixio mcp                 Wire Affix into known MCP client configs
  npx affixio mcp install         Same as default
  npx affixio mcp status          Show whether Affix is present in known configs
  npx affixio mcp remove          Remove Affix entry only (leave other servers)
  npx affixio mcp print           Print JSON snippet / URL (no writes)

Flags:
  --dry-run     Show merge plan without writing
  --project     Also write ./.cursor/mcp.json (create .cursor/ if needed)
  --url <url>   Override MCP URL (default ${DEFAULT_MCP_URL})
  --stdio       Force mcp-remote stdio shape instead of native url
  --open        Open ${DEFAULT_MCP_URL} in a browser after success

Memorable one-liner:
  npx affixio mcp

OAuth / API keys stay in AffixIO Hub — this CLI only writes client config.
`);
}

/**
 * CLI entry used by dist/cli.js
 * @param {string[]} argv args after the "mcp" token
 */
export async function runMcpCli(argv = process.argv.slice(3)) {
  let parsed;
  try {
    parsed = parseMcpArgs(argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
    return;
  }
  const { sub, flags } = parsed;

  if (sub === "help") {
    printHelp();
    return;
  }

  if (sub === "print") {
    printSnippet(flags.url, flags.stdio);
    return;
  }

  const targets = discoverTargets({ project: flags.project });

  if (sub === "status") {
    if (targets.length === 0) {
      console.log("No known MCP client configs detected.");
      return;
    }
    let any = false;
    for (const t of targets) {
      const s = statusOf(t);
      const mark = s.present ? "✓" : "·";
      console.log(`${mark} ${s.target.label}: ${s.detail}`);
      console.log(`  ${s.target.path}`);
      if (s.present) any = true;
    }
    if (!any) {
      console.log("");
      console.log("Affix not wired yet. Run: npx affixio mcp");
    }
    return;
  }

  if (sub === "remove") {
    const plans = targets.map((t) => planRemove(t));
    let removed = 0;
    for (const plan of plans) {
      if (plan.action === "skip") {
        console.log(`· ${plan.target.label}: ${plan.reason}`);
        continue;
      }
      console.log(`${flags.dryRun ? "would remove" : "removed"} ${plan.name} from ${plan.target.label}`);
      console.log(`  ${plan.path}`);
      if (!flags.dryRun) writeJsonPretty(plan.path, plan.nextDoc);
      removed++;
    }
    if (removed === 0) {
      console.log("No Affix MCP entries found to remove.");
    } else if (!flags.dryRun) {
      console.log("");
      console.log("Done. Restart or reload your MCP client if it was already open.");
    }
    return;
  }

  if (sub !== "install" && sub !== "connect") {
    console.error(`Unknown mcp subcommand: ${sub}`);
    console.error("Try: npx affixio mcp --help");
    process.exitCode = 1;
    return;
  }

  // install / connect (default)
  if (targets.length === 0) {
    console.log("No MCP client configs found to update.");
    console.log("Print a snippet with: npx affixio mcp print");
    printSnippet(flags.url, flags.stdio);
    return;
  }

  const plans = targets.map((t) =>
    planInstall(t, { url: flags.url, forceStdio: flags.stdio, dryRun: flags.dryRun })
  );

  let wrote = 0;
  for (const plan of plans) {
    if (plan.action === "skip") {
      console.log(`· ${plan.target.label}: ${plan.reason}`);
      continue;
    }
    const verb = flags.dryRun
      ? (plan.willCreate ? "would create" : `would ${plan.action}`)
      : (plan.willCreate ? "created" : plan.action === "update" ? "updated" : "added");
    console.log(`${verb} ${plan.name} (${plan.shape}) → ${plan.target.label}`);
    console.log(`  ${plan.path}`);
    if (flags.dryRun) {
      console.log("  entry:", JSON.stringify(plan.entry));
    } else {
      writeJsonPretty(plan.path, plan.nextDoc);
    }
    wrote++;
  }

  console.log("");
  if (flags.dryRun) {
    console.log(`Dry-run complete (${wrote} target${wrote === 1 ? "" : "s"}). Re-run without --dry-run to apply.`);
  } else if (wrote > 0) {
    console.log("✓ AffixIO MCP connected.");
    console.log("");
    console.log("  Sticky command:  npx affixio mcp");
    console.log(`  Server URL:      ${flags.url}`);
    console.log("");
    console.log("Next: open Cursor (or your MCP client) and approve AffixIO in Hub when prompted.");
    console.log("      Hub: https://hub.affix-io.com/");
  } else {
    console.log("Nothing written. Use --project to force ./.cursor/mcp.json, or: npx affixio mcp print");
  }

  if (flags.open && !flags.dryRun) {
    const ok = openBrowser(flags.url);
    console.log(ok ? `Opened ${flags.url}` : `Could not open browser; visit ${flags.url}`);
  }
}
