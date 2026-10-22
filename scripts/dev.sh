#!/usr/bin/env bash
# Start Cartograph behind a public HTTPS tunnel and print the URLs for ChatGPT and GitHub.
#   scripts/dev.sh            real agents (needs OPENAI_API_KEY in .env)
#   scripts/dev.sh fixture    offline fixture brain + separate dev data (UI work, no API calls)
# A live tunnel is reused across restarts, so the ChatGPT URL stays the same.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-8787}"
[ -f .env ] || cp .env.example .env

# The secret URL prefix: remote callers must know it (see src/server/security.ts).
if ! grep -qE '^CARTOGRAPH_ACCESS_TOKEN=.{20,}' .env; then
  grep -v '^CARTOGRAPH_ACCESS_TOKEN=' .env > .env.tmp || true
  mv .env.tmp .env
  echo "CARTOGRAPH_ACCESS_TOKEN=$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | cut -c1-40)" >> .env
fi
TOKEN=$(grep -E '^CARTOGRAPH_ACCESS_TOKEN=' .env | tail -1 | cut -d= -f2-)

if [ "${1:-}" = "fixture" ]; then
  export CARTOGRAPH_BRAIN=fixture CARTOGRAPH_DATA_DIR="$PWD/.cartograph-dev"
  [ -d .playground/chai-commerce ] || git clone -q ../chai-commerce .playground/chai-commerce
  export CARTOGRAPH_DEMO_REPO=.playground/chai-commerce CARTOGRAPH_LOCAL_REPOS="$PWD/.playground/chai-commerce"
fi

echo "Building UI…"; npx vite build --logLevel error
pkill -f "src/server/index.ts" 2>/dev/null || true

# Reuse the tunnel if it's still registered (502 = tunnel up, server down).
URL=""
if pgrep -f "cloudflared tunnel --no-autoupdate --url http://localhost:$PORT" >/dev/null && [ -f .tunnel.log ]; then
  URL=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" .tunnel.log | head -1 || true)
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -m 8 "$URL/favicon.ico" || echo 000)
  case "$CODE" in 204|502|404|403) echo "Reusing tunnel $URL" ;; *) URL="" ;; esac
fi
if [ -z "$URL" ]; then
  pkill -f "cloudflared tunnel --no-autoupdate --url http://localhost:$PORT" 2>/dev/null || true
  # Own session, so stopping or restarting the server never takes the tunnel down.
  python3 -c 'import subprocess, sys; subprocess.Popen(sys.argv[1:], stdout=open(".tunnel.log", "w"), stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, start_new_session=True)' \
    ./bin/cloudflared tunnel --no-autoupdate --url "http://localhost:$PORT"
  for _ in $(seq 1 60); do
    URL=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" .tunnel.log | head -1 || true)
    [ -n "$URL" ] && break; sleep 0.5
  done
  [ -n "$URL" ] || { echo "Tunnel failed; see .tunnel.log"; exit 1; }
  echo "New tunnel: update the URL in ChatGPT (Plugins → Cartograph) and the GitHub webhook."
fi

echo
echo "  ChatGPT connector URL : $URL/$TOKEN/mcp"
echo "  GitHub webhook URL    : $URL/webhooks/github"
echo "  Cartograph UI (anywhere)   : $URL/$TOKEN/app"
echo "  Cartograph UI (this Mac)   : http://localhost:$PORT/app"
echo "  Keep these private: the token in the URL is the password."
echo
# caffeinate: an idle-sleeping Mac silently kills the tunnel (and the demo).
PUBLIC_URL="$URL" PORT="$PORT" exec caffeinate -i npx tsx --env-file-if-exists=.env src/server/index.ts
