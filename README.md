![Claude sending a payout with Swipelux](assets/demo.gif)

# Swipelux for Developers

Run your Swipelux account from your coding agent. Create customers, request capabilities, answer Tasks, issue wallets and bank accounts, and quote and send transfers, all from Claude Code, Codex or Claude.

It includes everything in the Swipelux plugin from the Claude directory, plus money movement. Install one of them, not both.

## Install

### Claude Code

```bash
claude plugin marketplace add swipelux/agent-plugin
claude plugin install swipelux-dev@swipelux
```

Run `/mcp`, pick **swipelux** and sign in.

### Codex

```bash
codex plugin marketplace add swipelux/agent-plugin
codex plugin add swipelux-dev@swipelux
```

Start a new session and sign in when prompted.

### Claude (web and desktop)

**Settings > Connectors > Add custom connector**, URL `https://www.swipelux.app/api/mcp`.

## Sign in

Signing in opens Swipelux in your browser. You pick a space (sandbox is preselected) and the permissions for this connection, then confirm with your passkey. Swipelux creates a key for the connection; revoke it any time on the **API Keys** page.

Start in a sandbox space. In a live space, transfers move real money.

## Try it

- "Create a sandbox business customer for Acme Ltd and request USD bank accounts."
- "Which customers have open Tasks, and what does the Bank still need?"
- "Pay out 250 USDC from Acme's wallet to their US bank account."
- "Show me today's transfers that are still processing."

Claude shows the quote and asks before it sends a transfer.

## What's inside

| Part | What it does |
| --- | --- |
| `swipelux` MCP server | Your account: every Swipelux API operation your connection's permissions allow |
| `swipelux-docs` MCP server | Searches the public Swipelux docs. No account needed |
| Skills | `swipelux-getting-started`, `swipelux-integration`, `swipelux-compliance`, `swipelux-payments`: the right order of calls for each job |

## Headless setup

For CI or servers, create an MCP key on the **API Keys** page (MCP Keys tab) and send it as the `X-API-Key` header.

```bash
claude mcp add --transport http swipelux https://www.swipelux.app/api/mcp --header "X-API-Key: $SWIPELUX_MCP_KEY"
```

Codex `config.toml`:

```toml
[mcp_servers.swipelux]
url = "https://www.swipelux.app/api/mcp"
env_http_headers = { "X-API-Key" = "SWIPELUX_MCP_KEY" }
```

## Adding Swipelux to your app?

[`npx @swipelux/wizard`](https://github.com/swipelux/wizard) writes the integration into your codebase with your coding agent and proves it in sandbox.

## Links

- Guide: https://docs.swipelux.com/integration/ai-agents
- Privacy: https://www.swipelux.com/legal/privacy-policy
- Support: support@swipelux.com

## Development

```bash
./scripts/check.sh
```

`scripts/known-tools.txt` lists the MCP tool names; update it when the server adds tools.

## License

[MIT](LICENSE)
