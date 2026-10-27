#!/usr/bin/env bash
# scripts/check.sh: validates both hosts' manifests and the shared rules.
set -euo pipefail
cd "$(dirname "$0")/.."

PLUGIN=plugins/swipelux-dev
MCP_URL='"https://www.swipelux.app/api/mcp"'
DOCS_URL='"https://docs.swipelux.com/mcp"'

for f in .claude-plugin/marketplace.json .agents/plugins/marketplace.json \
         "$PLUGIN/.claude-plugin/plugin.json" "$PLUGIN/plugin.json" \
         "$PLUGIN/.mcp.json" "$PLUGIN/mcp.json"; do
  jq -e . "$f" >/dev/null || { echo "invalid JSON: $f"; exit 1; }
done

if command -v claude >/dev/null; then
  claude plugin validate .
  claude plugin validate "$PLUGIN"
else
  echo "claude CLI not found; skipping claude plugin validate"
fi

# Both hosts point at the same two servers.
for f in "$PLUGIN/.mcp.json" "$PLUGIN/mcp.json"; do
  [ "\"$(jq -r '.mcpServers.swipelux.url' "$f")\"" = "$MCP_URL" ] || { echo "account MCP URL wrong: $f"; exit 1; }
  [ "\"$(jq -r '.mcpServers["swipelux-docs"].url' "$f")\"" = "$DOCS_URL" ] || { echo "docs MCP URL wrong: $f"; exit 1; }
done

# Plugin names agree across manifests and marketplaces.
names=$(jq -r .name "$PLUGIN/.claude-plugin/plugin.json" "$PLUGIN/plugin.json" \
  && jq -r '.plugins[].name' .claude-plugin/marketplace.json .agents/plugins/marketplace.json)
[ "$(sort -u <<<"$names")" = "swipelux-dev" ] || { echo "plugin names differ: $names"; exit 1; }

# Versions agree across both plugin manifests.
v1=$(jq -r .version "$PLUGIN/.claude-plugin/plugin.json")
v2=$(jq -r .version "$PLUGIN/plugin.json")
[ "$v1" = "$v2" ] || { echo "version mismatch: $v1 vs $v2"; exit 1; }

skills=("$PLUGIN"/skills/*/SKILL.md)
[ -e "${skills[0]}" ] || { echo "no skills found"; exit 1; }
for skill in "${skills[@]}"; do
  head -1 "$skill" | grep -qx -- '---' || { echo "missing frontmatter: $skill"; exit 1; }
  dir=$(basename "$(dirname "$skill")")
  grep -qx "name: $dir" "$skill" || { echo "name must equal folder ($dir): $skill"; exit 1; }
  grep -q '^description: ' "$skill" || { echo "missing description: $skill"; exit 1; }
done

# Every tool a skill names must exist on the account or docs MCP server.
# known-tools.txt lists the tools the Swipelux MCP server serves, plus the docs server's tools.
# Other snake_case terms skills may quote: tool input fields, Task statuses, channels.
missing=$(grep -ohE '`[a-z]+(_[a-z0-9]+)+`' "$PLUGIN"/skills/*/SKILL.md README.md \
  | tr -d '`' | sort -u \
  | grep -vxF -f scripts/known-tools.txt -e idempotency_key -e action_required -e in_review -e verification_session || true)
[ -z "$missing" ] || { echo "unknown tool names: $missing"; exit 1; }

# Say capability, not rail. Provider names are checked by Swipelux's private leak scan before publishing.
if grep -rniE '\brails?\b' plugins .claude-plugin .agents README.md; then
  echo "forbidden vocabulary"; exit 1
fi
echo "ok"
