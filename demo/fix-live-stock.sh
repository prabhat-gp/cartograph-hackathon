#!/usr/bin/env bash
# The fix: live stock comes from the API (which already returns `available`).
set -euo pipefail
# The demo repo: the argument, else $CARTOGRAPH_DEMO_REPO, else ~/chai-commerce, else beside this repo.
REPO="${1:-${CARTOGRAPH_DEMO_REPO:-}}"
if [ -z "$REPO" ]; then
  REPO="$HOME/chai-commerce"
  [ -d "$REPO" ] || REPO="$(cd "$(dirname "$0")/../.." && pwd)/chai-commerce"
fi
cd "$REPO"
if [ ! -f web/lib/db.ts ]; then echo "Nothing to fix: the bad commit isn't there."; exit 1; fi
git rm -q web/lib/db.ts web/app/cart/stock.ts
python3 - <<'PY'
p = "web/app/cart/page.tsx"
s = open(p).read()
s = s.replace('import { liveStock } from "./stock";\n', '')
s = s.replace('  const [stock, setStock] = useState<Record<number, number>>({});\n', '')
s = s.replace('    api.cart().then((cart) => {\n      setItems(cart);\n      liveStock(cart.map((i) => i.productId)).then(setStock);\n    });', '    api.cart().then(setItems);')
s = s.replace('          {stock[i.productId] !== undefined && stock[i.productId] < 5 && <em> Only {stock[i.productId]} left!</em>}',
              '          {(byId.get(i.productId)?.available ?? 99) < 5 && <em> Only {byId.get(i.productId)?.available} left!</em>}')
open(p, "w").write(s)
PY
python3 - <<'PY'
import json
p = "web/package.json"
j = json.load(open(p))
j["dependencies"].pop("pg", None)
open(p, "w").write(json.dumps(j, indent=2) + "\n")
PY
git add -A
git commit -q -m "fix(cart): read live stock from the API"
echo "Committed $(git rev-parse --short HEAD): fix(cart): read live stock from the API"
if git remote get-url origin 2>/dev/null | grep -q "github.com"; then git push -q origin HEAD && echo "Pushed."; else
  curl -s -X POST "${CARTOGRAPH_URL:-http://localhost:8787}/hooks/local" -H 'content-type: application/json' -d "{\"repo\":\"$REPO\"}" && echo; fi
