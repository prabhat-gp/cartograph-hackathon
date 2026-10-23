#!/usr/bin/env bash
# One-time setup on the Zetaris server (Ubuntu): Node 22, Caddy, the first
# release, and the services. Run as ubuntu:  CARTOGRAPH_DOMAIN=example.com bash setup.sh
# Before running: put the server's .env at ~/cartograph/cartograph.env.
set -euo pipefail
: "${CARTOGRAPH_DOMAIN:?set CARTOGRAPH_DOMAIN to the host name of the site}"
ROOT=/home/ubuntu/cartograph
REPO=https://github.com/prabhat-gp/cartograph-hackathon.git

if ! node --version 2>/dev/null | grep -q '^v22'; then
	curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
	sudo apt-get install -y nodejs
fi
if ! command -v caddy >/dev/null; then
	sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
	curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
	curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt | sudo tee /etc/apt/sources.list.d/caddy-stable.list
	sudo apt-get update && sudo apt-get install -y caddy
fi

mkdir -p "$ROOT/releases" "$ROOT/data"
test -f "$ROOT/cartograph.env" || { echo "missing $ROOT/cartograph.env" >&2; exit 1; }

# The first release; later ones come from the timer.
if [ ! -e "$ROOT/current" ]; then
	git clone --quiet --depth 1 --branch main "$REPO" "$ROOT/releases/first"
	(cd "$ROOT/releases/first" && npm ci --no-audit --no-fund && npm --prefix site ci --no-audit --no-fund && npm run build)
	ln -sfn "releases/first" "$ROOT/current"
fi

here="$ROOT/current/deploy"
sudo cp "$here/cartograph.service" "$here/cartograph-update.service" "$here/cartograph-update.timer" /etc/systemd/system/
sed "s/CARTOGRAPH_DOMAIN/$CARTOGRAPH_DOMAIN/" "$here/Caddyfile" | sudo tee /etc/caddy/Caddyfile >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now cartograph cartograph-update.timer
sudo systemctl restart caddy
echo "Cartograph: https://$CARTOGRAPH_DOMAIN"
