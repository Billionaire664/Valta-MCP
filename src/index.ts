#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ValtaClient, ValtaApiError } from "./valta-client.js";

const apiKey = process.env.VALTA_API_KEY;
const baseUrl = process.env.VALTA_BASE_URL;

if (!apiKey) {
  console.error(
    "VALTA_API_KEY environment variable is required. Get a key at https://valta.co/dashboard"
  );
  process.exit(1);
}

const valta = new ValtaClient(apiKey, baseUrl);

const server = new McpServer({
  name: "valta-mcp",
  version: "0.1.0",
});

function errorResult(err: unknown) {
  if (err instanceof ValtaApiError) {
    return {
      content: [
        { type: "text" as const, text: `Valta API error (${err.status}): ${err.message}` },
      ],
      isError: true,
    };
  }
  return {
    content: [
      {
        type: "text" as const,
        text: `Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
      },
    ],
    isError: true,
  };
}

server.tool(
  "valta_check_balance",
  "Check an agent's Valta wallet balance and spend limits. Call this before " +
    "attempting a spend to confirm funds are available. This does not spend anything.",
  {
    agentId: z.string().describe("The Valta agent/wallet ID or name to check"),
  },
  async ({ agentId }) => {
    try {
      const result = await valta.getWallet(agentId);
      return { content: [{ type: "text", text: JSON.stringify(result.wallet, null, 2) }] };
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.tool(
  "valta_request_spend",
  "Request authorization to spend from an agent's Valta wallet. Returns approved " +
    "with a new balance, or denied with a reason. IMPORTANT: this tool only governs " +
    "spend that routes through it — it does not intercept or prevent spending done " +
    "via other tools, APIs, or webhooks that don't call this tool first. If denied, " +
    "do not proceed with the action and inform the user why.",
  {
    agentId: z.string().describe("The Valta agent/wallet ID or name making the spend"),
    amount: z.number().positive().describe("Amount in USDC to spend"),
    description: z.string().describe("What this spend is for — recorded in the audit trail"),
    category: z.string().optional().describe("Optional spend category"),
  },
  async ({ agentId, amount, description, category }) => {
    try {
      const result = await valta.requestSpend(agentId, amount, description, category);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.tool(
  "valta_create_wallet",
  "Create a new named Valta wallet with optional spend limits. Use this to set up " +
    "governance for a new agent before it starts spending.",
  {
    name: z.string().max(64).describe("A unique name for this wallet, e.g. the agent's name"),
    perTxLimit: z.number().positive().optional().describe("Max USDC per single transaction"),
    dailyLimit: z.number().positive().optional().describe("Max USDC per day"),
    monthlyLimit: z.number().positive().optional().describe("Max USDC per month"),
  },
  async ({ name, perTxLimit, dailyLimit, monthlyLimit }) => {
    try {
      const result = await valta.createWallet({ name, perTxLimit, dailyLimit, monthlyLimit });
      return { content: [{ type: "text", text: JSON.stringify(result.wallet, null, 2) }] };
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.tool(
  "valta_freeze_agent",
  "Immediately freeze an agent's Valta wallet, blocking all further spend through " +
    "Valta. Use this as a kill switch when an agent is behaving unexpectedly.",
  {
    agentId: z.string().describe("The Valta agent/wallet ID or name to freeze"),
  },
  async ({ agentId }) => {
    try {
      await valta.freezeAgent(agentId);
      return {
        content: [
          { type: "text", text: `Agent ${agentId} frozen. Spend through Valta is now blocked.` },
        ],
      };
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.tool(
  "valta_unfreeze_agent",
  "Unfreeze a previously frozen agent's Valta wallet, allowing spend to resume.",
  {
    agentId: z.string().describe("The Valta agent/wallet ID or name to unfreeze"),
  },
  async ({ agentId }) => {
    try {
      await valta.unfreezeAgent(agentId);
      return { content: [{ type: "text", text: `Agent ${agentId} unfrozen.` }] };
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.tool(
  "valta_get_audit_trail",
  "Read the tamper-evident, hash-chained audit trail of spend decisions (approved " +
    "and denied) for an agent, or across all agents if no agentId is given.",
  {
    agentId: z.string().optional().describe("Optional — filter to a single agent's audit trail"),
    limit: z
      .number()
      .int()
      .positive()
      .max(100)
      .optional()
      .describe("Max entries to return, default 20"),
  },
  async ({ agentId, limit }) => {
    try {
      const result = await valta.getAuditTrail(agentId, limit ?? 20);
      return { content: [{ type: "text", text: JSON.stringify(result.logs, null, 2) }] };
    } catch (err) {
      return errorResult(err);
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Valta MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error starting Valta MCP server:", err);
  process.exit(1);
});
