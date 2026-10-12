import { clone, required } from "./canonical.js";
import { digest } from "./budget.js";

export function expressGate(authorize) {
  return async (req, res, next) => {
    try {
      const result = await authorize(req);
      if (result.decision !== "allow") return res.status(result.decision === "review" ? 409 : 403).json({ decision: result.decision });
      req.affixDecision = result;
      return next();
    } catch (error) { return next(error); }
  };
}

export function fastifyGate(authorize) {
  return async (request, reply) => {
    const result = await authorize(request);
    if (result.decision !== "allow") return reply.code(result.decision === "review" ? 409 : 403).send({ decision: result.decision });
    request.affixDecision = result;
  };
}

export function createMcpGate({ tools, canDiscover, authorize, execute }) {
  const definitions = new Map(tools.map(tool => [required(tool.name, "tool name"), clone(tool)]));
  if (definitions.size !== tools.length) throw new Error("Duplicate MCP tool names");
  return {
    async list(context) {
      const visible = [];
      for (const tool of definitions.values()) if (await canDiscover(context, clone(tool)) === true) visible.push(clone(tool));
      return { tools: visible };
    },
    async call(name, args, context) {
      const tool = definitions.get(name);
      if (!tool || await canDiscover(context, clone(tool)) !== true) throw new Error("Tool unavailable");
      const input = clone(args);
      const decision = await authorize({ name, arguments: input, context });
      if (decision.decision !== "allow") return { isError: true, content: [{ type: "text", text: decision.decision === "review" ? "Human review required" : "Action not authorized" }] };
      return execute({ name, arguments: input, context, decision });
    },
  };
}

export function guardedAction(session, proposal, operation) {
  const record = session.propose(proposal);
  if (record.state !== "ready") return Promise.resolve({ record, value: null });
  return session.execute(record.id, operation);
}

export function createMcpConnection({ command, args = [], apiKeyEnv = "AFFIX_API_KEY" }) {
  required(command, "MCP server command");
  if (!Array.isArray(args) || !args.every(arg => typeof arg === "string")) throw new TypeError("Arguments must be strings");
  if (!/^[A-Z_][A-Z0-9_]*$/.test(apiKeyEnv)) throw new TypeError("Invalid API key environment variable");
  return { transport: "stdio", command, args: [...args], requiredEnvironment: [apiKeyEnv] };
}

export function a2aEvidencePart(handover) {
  if (handover.receipt?.schema !== "affix.handover.v1" || digest(handover.receipt) !== handover.digest) throw new Error("Invalid handover");
  return { kind: "data", data: clone(handover), metadata: { "affixio/evidence": "handover.v1" } };
}
