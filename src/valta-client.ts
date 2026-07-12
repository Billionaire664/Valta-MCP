/**
 * Thin wrapper over Valta's real REST API. No logic lives here beyond
 * request/response shaping — the spend gate, limits, and audit chain
 * are all enforced server-side by Valta, not by this client.
 */

const DEFAULT_BASE_URL = "https://valta.co/api/v1";

export class ValtaApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown
  ) {
    super(message);
    this.name = "ValtaApiError";
  }
}

export class ValtaClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl: string = DEFAULT_BASE_URL) {
    if (!apiKey) {
      throw new Error(
        "Valta API key is required. Set VALTA_API_KEY in your environment."
      );
    }
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new ValtaApiError(
        (data as any)?.error || `Valta API error (${res.status})`,
        res.status,
        data
      );
    }

    return data as T;
  }

  getWallet(agentId: string) {
    return this.request<{
      success: boolean;
      wallet: {
        agentId: string;
        balance: number;
        spendLimit?: number;
        budgetAllocated?: number;
        budgetSpent?: number;
        status: string;
      };
    }>("GET", `/agents/${encodeURIComponent(agentId)}/wallet`);
  }

  requestSpend(agentId: string, amount: number, description: string, category?: string) {
    return this.request<
      | { approved: true; newBalance: number }
      | { approved: false; reason: string; requiresApproval?: boolean; requestId?: string }
    >("POST", `/agents/${encodeURIComponent(agentId)}/wallet/spend`, {
      amount,
      description,
      category,
    });
  }

  createWallet(params: {
    name: string;
    perTxLimit?: number;
    dailyLimit?: number;
    monthlyLimit?: number;
    currency?: string;
  }) {
    return this.request<{ success: boolean; wallet: { walletId: string; name: string } }>(
      "POST",
      "/wallets",
      params
    );
  }

  freezeAgent(agentId: string) {
    return this.request<{ success: boolean }>(
      "POST",
      `/agents/${encodeURIComponent(agentId)}/freeze`
    );
  }

  unfreezeAgent(agentId: string) {
    return this.request<{ success: boolean }>(
      "POST",
      `/agents/${encodeURIComponent(agentId)}/unfreeze`
    );
  }

  getAuditTrail(agentId?: string, limit: number = 20) {
    const params = new URLSearchParams();
    if (agentId) params.set("agentId", agentId);
    params.set("limit", String(limit));
    return this.request<{
      logs: Array<{
        id: string;
        agentId: string;
        action: string;
        amount?: string;
        hash: string;
        previousHash: string;
        createdAt: string;
      }>;
    }>("GET", `/audit?${params.toString()}`);
  }

  listWallets() {
    return this.request<{ success: boolean; wallets: any[] }>("GET", "/wallets");
  }

  transferFunds(params: { fromAgentId: string; toAgentId: string; amount: number; description?: string }) {
    return this.request<{ success: boolean }>("POST", "/wallet/transfer", params);
  }

  listAgents(limit = 20, offset = 0) {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    return this.request<{ success: boolean; agents: any[]; total: number }>(
      "GET",
      `/agents?${params.toString()}`
    );
  }

  getAgent(agentId: string) {
    return this.request<{ success: boolean; agent: any }>("GET", `/agents/${encodeURIComponent(agentId)}`);
  }

  runAgent(agentId: string, task: string, context?: string) {
    return this.request<{ success: boolean; executionId: string }>(
      "POST",
      `/agents/${encodeURIComponent(agentId)}/run`,
      { task, context }
    );
  }

  getAgentRun(agentId: string, runId: string) {
    return this.request<{ success: boolean; run: any }>(
      "GET",
      `/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}`
    );
  }

  listPolicies(agentId?: string) {
    const params = new URLSearchParams();
    if (agentId) params.set("agentId", agentId);
    return this.request<{ success: boolean; policies: any[] }>("GET", `/policies?${params.toString()}`);
  }

  setPolicy(params: {
    name: string;
    agentId?: string;
    maxSpendPerDay?: number;
    maxSpendPerTransaction?: number;
  }) {
    return this.request<{ success: boolean; policy: any }>("POST", "/policies", params);
  }

  proxyRequest(params: {
    agentId: string;
    service: string;
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    path: string;
    body?: unknown;
    amount: number;
    description: string;
    category?: string;
  }) {
    return this.request<
      | { success: true; status: number; body: unknown; newBalance: number }
      | { error: string; requiresApproval: true; requestId?: string }
    >("POST", "/proxy", params);
  }

  listProxyRequests(agentId?: string, limit: number = 20) {
    const params = new URLSearchParams();
    if (agentId) params.set("agentId", agentId);
    params.set("limit", String(limit));
    return this.request<{
      success: boolean;
      requests: Array<{
        id: string;
        agentId: string;
        service: string;
        method: string;
        path: string;
        amount: number;
        decision: "allowed" | "blocked" | "refunded" | "pending_approval";
        reason: string | null;
        responseStatus: number | null;
        description: string | null;
        createdAt: string;
      }>;
      pagination: { page: number; limit: number; total: number; hasMore: boolean; totalPages: number };
    }>("GET", `/proxy/requests?${params.toString()}`);
  }
}
