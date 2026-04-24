#!/usr/bin/env bash
# Spawn the built MCP server, send initialize + tools/list, print tool names.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f plugin/dist/index.js ]; then
  echo "plugin/dist/index.js missing; run 'npm run build' first." >&2
  exit 1
fi

node plugin/dist/index.js 2>/dev/null <<'EOF' | node -e '
  let buf = "";
  process.stdin.on("data", (d) => buf += d);
  process.stdin.on("end", () => {
    for (const line of buf.split("\n")) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id === 2 && msg.result && Array.isArray(msg.result.tools)) {
          for (const t of msg.result.tools) console.log(`- ${t.name}: ${t.description.split(".")[0]}.`);
        }
      } catch {}
    }
  });
'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
EOF
