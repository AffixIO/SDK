import http from "node:http";
import { AffixSDK, paidApiAgentPolicy, x402BeforePay } from "affixio";

const sdk = new AffixSDK({
  apiKey: process.env.AFFIX_API_KEY || "aio_demo",
  licenceOnly: true,
  autoFlush: false,
});

const port = Number(process.env.PORT || 8788);

const policy = paidApiAgentPolicy({
  currency: "USD",
  maxPerAction: 2,
  maxPerDay: 25,
});

const server = http.createServer(async (req, res) => {
  if (req.url !== "/paid-report") {
    res.writeHead(404);
    res.end("not found");
    return;
  }

  const decision = await x402BeforePay({
    sdk,
    policy,
    agentId: req.headers["x-agent-id"] || "agent://unknown",
    resource: "https://api.example.com/paid-report",
    merchant: "api.example.com",
    amount: 1.25,
    currency: "USD",
    category: "api",
  });

  if (!decision.allowed) {
    res.writeHead(402, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: decision.reason, receipt: decision.receipt }));
    return;
  }

  res.writeHead(200, { "content-type": "application/json", "x-affix-proof-id": decision.receipt.proof_id || "" });
  res.end(JSON.stringify({ report: "demo data", receipt: decision.receipt }));
});

server.listen(port, "127.0.0.1", () => {
  console.log(`x402BeforePay demo on http://127.0.0.1:${port}/paid-report`);
});
