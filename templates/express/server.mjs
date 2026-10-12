// npm i affixio express
import express from "express";
import { gateToolCall } from "../../examples/gate/gate.mjs";

const app = express();
app.use(express.json());

app.post("/tools/search", async (req, res) => {
  const gate = await gateToolCall({ tool: "search_web", amount: Number(req.body?.cost ?? 0) });
  if (!gate.allowed) return res.status(403).json({ allowed: false, reason: gate.reason, receipt: gate.receipt });
  res.json({ allowed: true, results: ["..."], receipt: gate.receipt });
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, "127.0.0.1", () => console.log(`listening on http://127.0.0.1:${port}`));
