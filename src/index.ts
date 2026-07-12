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
  version: "0.1.4",
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

server.tool(
  "valta_list_wallets",
  "List all named Valta wallets on this account, with balances and limits. Use this " +
    "to discover what wallets exist before checking a balance or requesting a spend — " +
    "you need to know the exact wallet name/ID first.",
  {},
  async () => {
    try {
      const result = await valta.listWallets();
      return { content: [{ type: "text", text: JSON.stringify(result.wallets, null, 2) }] };
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.tool(
  "valta_transfer_funds",
  "Transfer USDC directly between two of your agent wallets.",
  {
    fromAgentId: z.string().describe("Wallet ID or name sending funds"),
    toAgentId: z.string().describe("Wallet ID or name receiving funds"),
    amount: z.number().positive().describe("Amount in USDC to transfer"),
    description: z.string().optional().describe("Optional description of the transfer"),
  },
  async ({ fromAgentId, toAgentId, amount, description }) => {
    try {
      const result = await valta.transferFunds({ fromAgentId, toAgentId, amount, description });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.tool(
  "valta_list_agents",
  "List all agents on this account — both marketplace subscriptions and custom SDK-created agents.",
  {
    limit: z.number().int().positive().optional().describe("Max results, default 20"),
    offset: z.number().int().nonnegative().optional().describe("Pagination offset, default 0"),
  },
  async ({ limit, offset }) => {
    try {
      const result = await valta.listAgents(limit ?? 20, offset ?? 0);
      return { content: [{ type: "text", text: JSON.stringify(result.agents, null, 2) }] };
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.tool(
  "valta_get_agent",
  "Get details for a single agent, including status and balance.",
  {
    agentId: z.string().describe("The agent ID to look up"),
  },
  async ({ agentId }) => {
    try {
      const result = await valta.getAgent(agentId);
      return { content: [{ type: "text", text: JSON.stringify(result.agent, null, 2) }] };
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.tool(
  "valta_run_agent",
  "Trigger an agent to run a task. Returns the run's execution ID and initial status.",
  {
    agentId: z.string().describe("The agent ID to run"),
    task: z.string().describe("The task instruction for the agent to execute"),
    context: z.string().max(2000).optional().describe("Optional additional context, max 2000 characters"),
  },
  async ({ agentId, task, context }) => {
    try {
      const result = await valta.runAgent(agentId, task, context);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.tool(
  "valta_get_agent_run",
  "Check the status and result of a specific agent run.",
  {
    agentId: z.string().describe("The agent ID the run belongs to"),
    runId: z.string().describe("The run ID to check"),
  },
  async ({ agentId, runId }) => {
    try {
      const result = await valta.getAgentRun(agentId, runId);
      return { content: [{ type: "text", text: JSON.stringify(result.run, null, 2) }] };
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.tool(
  "valta_list_policies",
  "List spending policies (limits, approval thresholds) configured on this account, optionally filtered to one agent.",
  {
    agentId: z.string().optional().describe("Optional — filter to policies for a single agent"),
  },
  async ({ agentId }) => {
    try {
      const result = await valta.listPolicies(agentId);
      return { content: [{ type: "text", text: JSON.stringify(result.policies, null, 2) }] };
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.tool(
  "valta_set_policy",
  "Create a new spending policy — a named limit configuration (daily cap, per-transaction " +
    "cap) that can be applied to an agent's spend.",
  {
    name: z.string().describe("A name for this policy"),
    agentId: z.string().optional().describe("Optional — the agent this policy applies to"),
    maxSpendPerDay: z.number().positive().optional().describe("Maximum USDC spend per day"),
    maxSpendPerTransaction: z.number().positive().optional().describe("Maximum USDC per single transaction"),
  },
  async ({ name, agentId, maxSpendPerDay, maxSpendPerTransaction }) => {
    try {
      const result = await valta.setPolicy({ name, agentId, maxSpendPerDay, maxSpendPerTransaction });
      return { content: [{ type: "text", text: JSON.stringify(result.policy, null, 2) }] };
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.tool(
  "valta_proxy_request",
  "Make a real outbound API call to a connected service (e.g. Stripe) through Valta's " +
    "spend-gated egress proxy, instead of calling the provider directly. Declare the " +
    "amount this call will cost up front — Valta checks it against the agent's wallet " +
    "limits (freeze state, per-transaction/daily/monthly caps, approval thresholds) and " +
    "only makes the real request if approved, using the account's own stored credential " +
    "for that service. If the upstream call fails, the declared amount is automatically " +
    "refunded. Only services with proxying enabled can be called this way — currently: " +
    "stripe, serper, polygon.",
  {
    agentId: z.string().describe("The Valta agent/wallet ID or name this spend is attributed to"),
    service: z.string().describe('The connected service to call, e.g. "stripe"'),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).describe("HTTP method for the upstream call"),
    path: z.string().describe("Path on the service's API, relative to its base URL, e.g. \"/v1/customers\""),
    body: z.record(z.any()).optional().describe("Optional JSON body to send with the request"),
    amount: z.number().positive().describe("Declared cost of this call in USD — checked against wallet limits before the real call is made"),
    description: z.string().describe("What this call is for — recorded in the audit trail"),
    category: z.string().optional().describe("Optional spend category"),
  },
  async ({ agentId, service, method, path, body, amount, description, category }) => {
    try {
      const result = await valta.proxyRequest({ agentId, service, method, path, body, amount, description, category });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.tool(
  "valta_list_proxy_requests",
  "List the receipts for every call made through Valta's spend-gated egress proxy — " +
    "what was allowed, blocked, refunded, or left pending approval, and why. Optionally " +
    "filter to one agent.",
  {
    agentId: z.string().optional().describe("Optional — filter to one agent's proxy requests"),
    limit: z.number().int().positive().max(100).optional().describe("Max results, default 20"),
  },
  async ({ agentId, limit }) => {
    try {
      const result = await valta.listProxyRequests(agentId, limit ?? 20);
      return { content: [{ type: "text", text: JSON.stringify(result.requests, null, 2) }] };
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
