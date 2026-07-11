# valta-mcp

[![CI](https://github.com/Billionaire664/valta-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Billionaire664/valta-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

An MCP (Model Context Protocol) server for [Valta](https://valta.co) — financial governance for AI agents. Exposes Valta's spend gate and audit trail as MCP tools, so any MCP-compatible client (Claude Desktop, Claude Code, Cursor, and others) can call them directly.

## What this is — and isn't

This server is a thin wrapper over Valta's real, hosted REST API. It does not implement any spend logic, limits, or hashing itself — every tool call here is a pass-through to `https://valta.co/api/v1/...`, where the actual enforcement (spend gate, audit chain) happens. This repo is the protocol adapter, not the enforcement engine.

**Important, read before relying on this for anything security-sensitive:** a tool description telling a model "call this before spending" is guidance, not enforcement. This server governs spend that routes through its `valta_request_spend` tool. It does **not** intercept or prevent spending that happens through other tools, APIs, or webhooks that don't call it first. If you need a hard guarantee that no spend can happen without authorization, the money-moving action itself needs to be implemented as (or wrapped by) a Valta-gated tool — not merely preceded by a polite check-in step. See [Design notes](#design-notes) below.

## Install

```bash
npm install -g valta-mcp
```

Or run directly without installing:

```bash
npx valta-mcp
```

## Configuration

Get an API key at [valta.co/dashboard](https://valta.co/dashboard) → Settings → API Keys → Create key.

Add to your MCP client's config (e.g. Claude Desktop's `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "valta": {
      "command": "npx",
      "args": ["valta-mcp"],
      "env": {
        "VALTA_API_KEY": "sk_valta_your_key_here"
      }
    }
  }
}
```

## Tools

| Tool | What it does |
|---|---|
| `valta_check_balance` | Read an agent's wallet balance and limits |
| `valta_request_spend` | Request authorization for a spend — approved or denied by the real spend gate |
| `valta_create_wallet` | Create a new named wallet with optional spend limits |
| `valta_freeze_agent` | Kill switch — freeze an agent's wallet, blocking further spend |
| `valta_unfreeze_agent` | Resume a frozen agent's wallet |
| `valta_get_audit_trail` | Read the hash-chained audit trail of spend decisions |

Every tool's description in [`src/index.ts`](./src/index.ts) states plainly what it enforces and what it doesn't — read those before wiring this into anything that touches real money.

## Design notes

**Why there's no "non-bypassable system prompt."** An earlier draft of this project considered shipping a system-prompt instruction block claiming to make spend gating "non-bypassable." That claim doesn't hold up, for two reasons:

1. **MCP servers don't control the host's system prompt.** Claude Desktop, Claude Code, Cursor, and other hosts each own their own system prompt. An MCP server provides tools and, in some cases, a limited `instructions` field — it cannot inject a binding, universally-enforced rule into the conversation.
2. **A system prompt is a request to the model, not a code-level constraint.** Even where a host does surface server instructions, an agent can still be prompt-injected, jailbroken, or simply routed through a different tool entirely that doesn't call this server at all. Claiming otherwise would be exactly the kind of gap this project exists to close — trusting the model to self-police is the failure mode Valta's spend gate was built to avoid in the first place.

**What actually provides a guarantee:** spend that is authorized by calling `valta_request_spend` is genuinely checked against real limits, server-side, independent of the calling model's behavior. The gap is spend that happens through some *other* channel the agent has access to. Closing that gap requires the payment-triggering action itself to be gated — either by making it a Valta-provided tool, or by having whatever executes the real payment call Valta's API internally before proceeding. This server is the piece that makes gated spend possible; it is not a universal guarantee that ungated spend is impossible.

## License

MIT.
