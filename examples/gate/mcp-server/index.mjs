// MCP server (official TypeScript SDK): gate before the handler runs.
// npm i affixio @modelcontextprotocol/sdk zod
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { gateToolCall, sdk } from "../gate.mjs";

const server = new McpServer({ name: "gated-tools", version: "0.1.0" });

server.registerTool(
  "search_web",
  { description: "Search the web", inputSchema: { query: z.string(), cost: z.number().default(0) } },
  async ({ query, cost }) => {
    const gate = await gateToolCall({ tool: "search_web", amount: cost });
    if (!gate.allowed) {
      return { isError: true, content: [{ type: "text", text: `denied: ${gate.reason}` }] };
    }
    return { content: [{ type: "text", text: JSON.stringify({ query, proof_id: gate.receipt.proof_id }) }] };
  },
);

// Local check: connect a client over an in-memory transport and call the tool twice.
// For a real server use StdioServerTransport instead.
const [clientT, serverT] = InMemoryTransport.createLinkedPair();
await server.connect(serverT);
const client = new Client({ name: "demo-client", version: "0.1.0" });
await client.connect(clientT);
for (const cost of [0.5, 50]) {
  const res = await client.callTool({ name: "search_web", arguments: { query: "mcp gating", cost } });
  console.log(cost, res.isError ? "error" : "ok", res.content[0].text);
}
await client.close();
sdk.dispose();
