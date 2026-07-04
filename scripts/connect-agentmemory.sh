#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-$(pwd)}"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20+ is required." >&2
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [[ "${NODE_MAJOR}" -lt 20 ]]; then
  echo "Node.js 20+ is required; found $(node -v)." >&2
  exit 1
fi

mkdir -p "${ROOT}/.mitii"
cat > "${ROOT}/.mitii/mcp.json" <<'JSON'
{
  "mcpServers": {
    "agentmemory": {
      "disabled": false,
      "type": "streamable-http",
      "url": "http://localhost:3111/mcp",
      "headers": {},
      "timeoutMs": 30000
    }
  }
}
JSON

echo "agentmemory MCP configured at ${ROOT}/.mitii/mcp.json"
echo "Install/start agentmemory separately, then verify http://localhost:3111/agentmemory/livez"
