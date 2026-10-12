import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServerEntry, parseMcpArgs, findAffixEntry, planInstall, planRemove } from "../dist/mcp-connect.js";

test("MCP helper emits config without API credentials and rejects unsafe URLs", () => {
  assert.deepEqual(buildServerEntry({ url: "https://www.affix-io.com/mcp/" }), { url: "https://www.affix-io.com/mcp/" });
  assert.equal(buildServerEntry({ url: "https://www.affix-io.com/mcp/", forceStdio: true }).command, "npx");
  for (const url of ["http://example.test/mcp", "javascript:alert(1)", "https://user:secret@example.test/mcp", "https://example.test/mcp?key=secret"]) {
    assert.throws(() => parseMcpArgs(["print", "--url", url]));
  }
});

test("MCP merge plans preserve unrelated servers and reject lookalike domains", () => {
  const directory = mkdtempSync(join(tmpdir(), "affix-mcp-config-"));
  try {
    const path = join(directory, "config.json");
    const original = { theme: "light", mcpServers: { unrelated: { url: "https://notaffix-io.com/mcp/" }, custom: { url: "https://www.affix-io.com/mcp/" } } };
    writeFileSync(path, JSON.stringify(original));
    const target = { id: "fixture", label: "Fixture", path, createIfMissing: false };
    const plan = planInstall(target, { url: "https://www.affix-io.com/mcp/", dryRun: true });
    assert.equal(plan.name, "custom");
    assert.deepEqual(plan.nextDoc.mcpServers.unrelated, original.mcpServers.unrelated);
    assert.equal(plan.nextDoc.theme, "light");
    assert.deepEqual(JSON.parse(readFileSync(path)), original);
    assert.equal(findAffixEntry({ unrelated: original.mcpServers.unrelated }), null);
    const remove = planRemove(target);
    assert.deepEqual(Object.keys(remove.nextDoc.mcpServers), ["unrelated"]);
    writeFileSync(path, '[]');
    assert.throws(() => planInstall(target, { url: "https://www.affix-io.com/mcp/" }), /configuration/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
