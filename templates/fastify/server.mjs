// npm i affixio fastify
import Fastify from "fastify";
import { gateToolCall } from "../../examples/gate/gate.mjs";

const app = Fastify();

app.post("/tools/search", async (req, reply) => {
  const gate = await gateToolCall({ tool: "search_web", amount: Number(req.body?.cost ?? 0) });
  if (!gate.allowed) return reply.code(403).send({ allowed: false, reason: gate.reason, receipt: gate.receipt });
  return { allowed: true, results: ["..."], receipt: gate.receipt };
});

await app.listen({ port: Number(process.env.PORT ?? 3001), host: "127.0.0.1" });
console.log("listening");
