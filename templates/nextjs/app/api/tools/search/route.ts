// Next.js App Router route handler. Node runtime only (the SDK uses node:crypto and fs).
// npm i affixio
import { AffixSDK, mcpToolGate, spendingPolicy } from "affixio";

export const runtime = "nodejs";

const sdk = new AffixSDK({ apiKey: process.env.AFFIX_API_KEY ?? "aio_demo", licenceOnly: true, autoFlush: false });
const policy = spendingPolicy().currency("GBP").maxPerAction(10);

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const gate = await mcpToolGate({ sdk, policy, tool: "search_web", amount: Number(body.cost ?? 0) });
  if (!gate.allowed) return Response.json({ allowed: false, reason: gate.reason }, { status: 403 });
  return Response.json({ allowed: true, results: ["..."], receipt: gate.receipt });
}
