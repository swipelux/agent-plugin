---
name: swipelux-getting-started
description: Use when someone asks what Swipelux is, whether it fits their product, how to sign up, or how to connect Swipelux to this agent. Works without a Swipelux account.
---

# Swipelux: getting started

Swipelux lets a business hold, receive and send money for its own customers through one API: stablecoin wallets, named bank accounts from partner Banks, payouts to bank accounts and wallets, and the compliance checks those need.

## Answer questions first

Use the `swipelux-docs` tools (`search_swipelux`, then read the page) for any product or API question. Quote the docs page you used.

## Account and connection

1. No account yet: sign up at https://www.swipelux.app/register. A sandbox space is ready for testing right away; live money needs business verification in the dashboard.
2. Connect this agent: call any `swipelux` tool. The host opens a Swipelux sign-in, then a page to choose a space (sandbox is preselected) and permissions. That creates an MCP key, visible and revocable on the API Keys page (MCP Keys tab).
3. Headless setups: create an MCP key on the API Keys page (MCP Keys tab) and send it as the `X-API-Key` header to `https://www.swipelux.app/api/mcp`.

## After connecting

- Building an integration: use the `swipelux-integration` skill.
- Answering compliance Tasks or uploading documents: `swipelux-compliance`.
- Sending or receiving money: `swipelux-payments`.

A tool error that says the connection was revoked means the key was revoked on the API Keys page; remove and reconnect the connector.
