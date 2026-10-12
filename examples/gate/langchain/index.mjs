// LangChain JS: gate inside a tool() function.
// npm i affixio @langchain/core zod
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { gateToolCall, sdk } from "../gate.mjs";

export const searchTool = tool(
  async ({ query }) => {
    const gate = await gateToolCall({ tool: "search_web", amount: 0.5 });
    if (!gate.allowed) return `denied: ${gate.reason}`;
    return JSON.stringify({ query, results: ["..."], proof_id: gate.receipt.proof_id });
  },
  { name: "search_web", description: "Search the web", schema: z.object({ query: z.string() }) },
);

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(await searchTool.invoke({ query: "mcp gating" }));
  sdk.dispose();
}
