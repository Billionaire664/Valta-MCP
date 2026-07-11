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
}
