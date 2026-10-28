#!/usr/bin/env bash
# Stage demo: a plausible feature commit that quietly breaks the layering.
# The storefront starts querying Postgres directly instead of going through the API.
set -euo pipefail
# The demo repo: the argument, else $CARTOGRAPH_DEMO_REPO, else ~/chai-commerce, else beside this repo.
REPO="${1:-${CARTOGRAPH_DEMO_REPO:-}}"
if [ -z "$REPO" ]; then
  REPO="$HOME/chai-commerce"
  [ -d "$REPO" ] || REPO="$(cd "$(dirname "$0")/../.." && pwd)/chai-commerce"
fi
cd "$REPO"
if [ -f web/lib/db.ts ]; then echo "The bad commit is already pushed. Push the fix first."; exit 1; fi

cat > web/lib/db.ts <<'TS'
import { Pool } from "pg";

// Direct connection so the cart can show live stock without an extra API hop.
export const db = new Pool({ connectionString: process.env.DATABASE_URL });
TS

cat > web/app/cart/stock.ts <<'TS'
"use server";
import { db } from "../../lib/db";

/** Live stock for the cart page ("Only 2 left!"). */
export async function liveStock(productIds: number[]): Promise<Record<number, number>> {
  const { rows } = await db.query("select product_id, stock - reserved as available from inventory where product_id = any($1)", [productIds]);
  return Object.fromEntries(rows.map((r) => [Number(r.product_id), Number(r.available)]));
}
TS

python3 - <<'PY'
p = "web/app/cart/page.tsx"
s = open(p).read()
s = s.replace('import { api, type Product, rupees } from "../../lib/api";',
              'import { api, type Product, rupees } from "../../lib/api";\nimport { liveStock } from "./stock";')
s = s.replace('  const [products, setProducts] = useState<Product[]>([]);',
              '  const [products, setProducts] = useState<Product[]>([]);\n  const [stock, setStock] = useState<Record<number, number>>({});')
s = s.replace('    api.cart().then(setItems);',
              '    api.cart().then((cart) => {\n      setItems(cart);\n      liveStock(cart.map((i) => i.productId)).then(setStock);\n    });')
s = s.replace('          {byId.get(i.productId)?.name} × {i.quantity}',
              '          {byId.get(i.productId)?.name} × {i.quantity}\n          {stock[i.productId] !== undefined && stock[i.productId] < 5 && <em> Only {stock[i.productId]} left!</em>}')
open(p, "w").write(s)
PY

python3 - <<'PY'
import json
p = "web/package.json"
j = json.load(open(p))
j["dependencies"]["pg"] = "^8.13.1"
open(p, "w").write(json.dumps(j, indent=2) + "\n")
PY

git add -A
git commit -q -m "feat(cart): show live stock on cart page"
echo "Committed $(git rev-parse --short HEAD): feat(cart): show live stock on cart page"
if git remote get-url origin 2>/dev/null | grep -q "github.com"; then
  git push -q origin HEAD && echo "Pushed. GitHub will call the Cartograph webhook."
else
  curl -s -X POST "${CARTOGRAPH_URL:-http://localhost:8787}/hooks/local" -H 'content-type: application/json' -d "{\"repo\":\"$REPO\"}" && echo
fi
