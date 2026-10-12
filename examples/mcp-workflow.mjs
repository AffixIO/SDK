import { MemoryStore, DecisionPipeline, WorkflowSession, createMcpGate } from "affixio/workflows";

const store = new MemoryStore();
const policy = { id: "project-build", version: "1", mode: "all", rules: [{ source: "permission", operator: "truthy", maxAgeMs: 30000 }] };
const pipeline = new DecisionPipeline({ sources: { permission: async input => ({ value: input.role === "builder" }) } });
const session = new WorkflowSession({ store, scope: "example", sessionId: "build-1" });
const gate = createMcpGate({
  tools: [{ name: "build_project", description: "Run the configured project build", inputSchema: { type: "object", properties: {} } }],
  canDiscover: context => context.role === "builder",
  authorize: ({ context }) => pipeline.evaluate(policy, { role: context.role, action: "build_project" }),
  execute: async ({ decision, context }) => {
    session.propose({ id: "request-1", intent: { role: context.role, action: "build_project" }, policy, result: decision });
    const { record } = await session.execute("request-1", async () => ({ simulated: true, built: true }));
    return { content: [{ type: "text", text: `Build simulation ${record.state}` }] };
  },
});
console.log(await gate.list({ role: "viewer" }));
console.log(await gate.call("build_project", {}, { role: "builder" }));
