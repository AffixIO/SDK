// OpenAI Agents SDK (JS): gate inside the tool's execute().
// npm i affixio @openai/agents zod
import { tool } from "@openai/agents";
import { z } from "zod";
import { gateToolCall, sdk } from "../gate.mjs";

export const searchTool = tool({
  name: "search_web",
  description: "Search the web",
  parameters: z.object({ query: z.string() }),
  async execute({ query }) {
    const gate = await gateToolCall({ tool: "search_web", amount: 0.5 });
    if (!gate.allowed) return `denied: ${gate.reason}`;
    return JSON.stringify({ query, results: ["..."], proof_id: gate.receipt.proof_id });
  },
});

// Local check without an OpenAI key: call the tool the way the runner does.
// With a key, pass it to an Agent instead: new Agent({ name, instructions, tools: [searchTool] }) and run(agent, "...").
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(await searchTool.invoke({}, JSON.stringify({ query: "mcp gating" })));
  sdk.dispose();
}
