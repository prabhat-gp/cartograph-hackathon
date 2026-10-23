#!/usr/bin/env bash
# Deploys main when it has moved: builds it in a fresh release folder, switches
# over only if the build passes, and switches back if the new server doesn't
# come up healthy. Keeps the last three releases.
set -euo pipefail
ROOT=/home/ubuntu/cartograph
REPO=https://github.com/prabhat-gp/cartograph-hackathon.git
cd "$ROOT"
mkdir -p releases

head=$(git ls-remote "$REPO" refs/heads/main | cut -f1)
live=$(basename "$(readlink -f current 2>/dev/null || echo none)")
[ -n "$head" ] && [ "$head" != "$live" ] || exit 0

echo "deploying $head (live: $live)"
tmp="releases/.building"
rm -rf "$tmp"
git clone --quiet --depth 1 --branch main "$REPO" "$tmp"
(
	cd "$tmp"
	npm ci --no-audit --no-fund
	npm --prefix site ci --no-audit --no-fund
	npm run build
	npm run typecheck
)
sha=$(git -C "$tmp" rev-parse HEAD)
rm -rf "releases/$sha"
mv "$tmp" "releases/$sha"

previous=$(readlink -f current 2>/dev/null || true)
ln -sfn "releases/$sha" current.next && mv -T current.next current
sudo systemctl restart cartograph

for _ in $(seq 45); do
	if curl -fsS http://127.0.0.1:8787/health >/dev/null; then
		echo "live: $sha"
		ls -1dt releases/*/ | tail -n +4 | xargs -r rm -rf
		exit 0
	fi
	sleep 2
done

echo "release $sha didn't come up healthy; switching back" >&2
if [ -n "$previous" ]; then
	ln -sfn "$previous" current.next && mv -T current.next current
	sudo systemctl restart cartograph
fi
exit 1
