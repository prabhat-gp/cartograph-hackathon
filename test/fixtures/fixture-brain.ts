// Offline stand-in for the agent brain (CARTOGRAPH_BRAIN=fixture). Hand-written for
// the chai-commerce demo repo so the UI and the verify/drift pipeline can be
// developed and tested without API calls. Stats are labelled "fixture" so this
// can never be mistaken for agent output.
import type { CartographEdge, CartographFlow, CartographNode } from "../../src/shared/graph";
import type { Brain, DraftGraph, ReviewResult, TraceResult } from "../../src/server/brain/types";

const n = (id: string, kind: CartographNode["kind"], label: string, summary: string, tech: string | undefined, files: string[], details: string[] = []): CartographNode => ({
  id,
  kind,
  label,
  summary,
  tech,
  files: files.map((path) => ({ path })),
  details,
});

let seq = 0;
const e = (from: string, to: string, kind: CartographEdge["kind"], label: string, path: string, snippet: string, line = 1): CartographEdge => ({
  id: `d${++seq}`,
  from,
  to,
  kind,
  label,
  evidence: [{ path, line, snippet }],
});

export const CHAI_NODES: CartographNode[] = [
  n("browser", "client", "Shopper's browser", "Customers browsing and paying on the storefront.", undefined, []),
  n("storefront", "frontend", "Storefront", "Next.js app-router storefront: catalog, cart, checkout, order tracking and OTP login.", "Next.js 15", ["web/app", "web/lib"], ["/", "/product/[id]", "/cart", "/checkout", "/orders/[id]", "/login"]),
  n("auth-api", "api", "Auth API", "Phone + OTP login; issues JWTs backed by Redis sessions.", "Express", ["api/src/routes/auth.ts", "api/src/services/otp.ts", "api/src/middleware/auth.ts"], ["POST /api/auth/otp", "POST /api/auth/verify"]),
  n("products-api", "api", "Products API", "Catalog listing (cached in Redis for 5 minutes) and product detail.", "Express", ["api/src/routes/products.ts"], ["GET /api/products", "GET /api/products/:slug"]),
  n("cart-api", "api", "Cart API", "Per-customer cart stored as a Redis hash with a 7-day TTL.", "Express", ["api/src/routes/cart.ts"], ["GET /api/cart", "POST /api/cart", "DELETE /api/cart/:productId"]),
  n("orders-api", "api", "Orders API", "Places orders from the cart and serves order status.", "Express", ["api/src/routes/orders.ts"], ["POST /api/orders", "GET /api/orders/:id"]),
  n("payments-webhook", "api", "Payments webhook", "Receives Razorpay payment.captured webhooks and verifies their signature.", "Express", ["api/src/routes/payments.ts"], ["POST /api/payments/webhook"]),
  n("order-service", "service", "Order service", "Reserves stock, prices the cart, opens a Razorpay order and announces order.created.", "TypeScript", ["api/src/services/orders.ts", "api/src/services/inventory.ts"]),
  n("payment-service", "service", "Payment service", "Idempotently marks orders paid, commits stock and announces order.paid.", "TypeScript", ["api/src/services/payments.ts"]),
  n("postgres", "database", "Postgres", "Customers, products, inventory, orders and order items.", "PostgreSQL 17", [], ["customers", "products", "inventory", "orders", "order_items"]),
  n("redis", "cache", "Redis", "Catalog cache, carts, OTPs and login sessions.", "Redis 7", [], ["catalog:v1", "cart:{customer}", "otp:{phone}", "session:{sid}"]),
  n("order-events", "queue", "order-events queue", "BullMQ queue carrying order.created and order.paid.", "BullMQ", ["api/src/queue.ts"], ["order.created", "order.paid"]),
  n("order-worker", "worker", "Order worker", "Sends receipts and books shipments after payment.", "BullMQ worker", ["worker/src"]),
  n("razorpay", "external", "Razorpay", "Payments: orders API server-side, Checkout in the browser, webhooks back.", "Razorpay", []),
  n("sendgrid", "external", "SendGrid", "Transactional email receipts.", "SendGrid", []),
  n("msg91", "external", "MSG91", "SMS OTP delivery.", "MSG91", []),
  n("shiprocket", "external", "Shiprocket", "Courier booking and shipment tracking.", "Shiprocket", []),
];

export function chaiDraftEdges(): CartographEdge[] {
  seq = 0;
  return [
    e("browser", "storefront", "http", "GET / (pages)", "web/app/page.tsx", "export default async function Home() {"),
    e("storefront", "products-api", "http", "GET /api/products", "web/lib/api.ts", 'products: () => call<Product[]>("/api/products"),'),
    e("storefront", "cart-api", "http", "POST /api/cart", "web/lib/api.ts", 'addToCart: (productId: number, quantity = 1) => call<void>("/api/cart"'),
    e("storefront", "orders-api", "http", "POST /api/orders", "web/lib/api.ts", 'call<{ orderId: number; razorpayOrderId: string; amount: number }>("/api/orders"'),
    e("storefront", "auth-api", "http", "POST /api/auth/otp", "web/lib/api.ts", 'requestOtp: (phone: string) => call<void>("/api/auth/otp"'),
    e("storefront", "razorpay", "sdk", "Razorpay Checkout (public key)", "web/lib/razorpay.ts", 'script.src = "https://checkout.razorpay.com/v1/checkout.js";'),
    e("products-api", "redis", "cache", "GET catalog:v1", "api/src/routes/products.ts", 'const cached = await redis.get("catalog:v1");'),
    e("products-api", "postgres", "sql", "SELECT products", "api/src/routes/products.ts", 'await db.query("select * from products where slug = $1 and active", [req.params.slug]);'),
    e("cart-api", "redis", "cache", "HINCRBY cart:{customer}", "api/src/routes/cart.ts", "await redis.hincrby(cartKey(req.customerId!), String(item.productId), item.quantity);"),
    e("cart-api", "auth-api", "call", "requireAuth", "api/src/routes/cart.ts", "cartRouter.use(requireAuth);"),
    e("orders-api", "order-service", "call", "createOrder()", "api/src/routes/orders.ts", "const order = await createOrder(req.customerId!, address);"),
    e("order-service", "redis", "cache", "HGETALL cart", "api/src/services/orders.ts", "const cart = await redis.hgetall(`cart:${customerId}`);"),
    e("order-service", "postgres", "sql", "INSERT INTO orders", "api/src/services/orders.ts", '"insert into orders (customer_id, total_paise, address) values ($1, $2, $3) returning id",'),
    e("order-service", "razorpay", "sdk", "razorpay.orders.create", "api/src/services/orders.ts", 'const rzpOrder = await razorpay.orders.create({ amount: total, currency: "INR", receipt: `order_${orderId}` });'),
    e("order-service", "order-events", "publish", "enqueue order.created", "api/src/services/orders.ts", 'await publish({ type: "order.created", orderId });'),
    e("razorpay", "payments-webhook", "webhook", "payment.captured", "api/src/routes/payments.ts", 'paymentsRouter.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {'),
    e("payments-webhook", "payment-service", "call", "markOrderPaid()", "api/src/routes/payments.ts", "await markOrderPaid(payment.order_id, payment.id);"),
    e("payment-service", "postgres", "sql", "UPDATE orders SET status = 'paid'", "api/src/services/payments.ts", "`update orders set status = 'paid', razorpay_payment_id = $2"),
    e("payment-service", "order-events", "publish", "enqueue order.paid", "api/src/services/payments.ts", 'if (rows[0]) await publish({ type: "order.paid", orderId: Number(rows[0].id) });'),
    e("order-worker", "order-events", "consume", "process order-events", "worker/src/index.ts", "const worker = new Worker<OrderEvent>("),
    e("order-worker", "sendgrid", "sdk", "sgMail.send (receipt)", "worker/src/jobs/sendReceipt.ts", "await sgMail.send({"),
    e("order-worker", "shiprocket", "http", "POST /orders/create/adhoc", "worker/src/jobs/createShipment.ts", "const res = await fetch(`${SHIPROCKET}/orders/create/adhoc`, {"),
    e("order-worker", "postgres", "sql", "UPDATE orders SET shipment_id", "worker/src/jobs/createShipment.ts", `await db.query("update orders set shipment_id = $1, status = 'shipped' where id = $2"`),
    e("auth-api", "msg91", "http", "POST /api/v5/otp", "api/src/services/otp.ts", "const res = await fetch(`${MSG91_URL}?template_id="),
    e("auth-api", "redis", "cache", "SET otp / session", "api/src/services/otp.ts", 'await redis.set(`otp:${phone}`, otp, "EX", 300);'),
    e("auth-api", "postgres", "sql", "UPSERT customers", "api/src/routes/auth.ts", '"insert into customers (phone) values ($1) on conflict (phone) do update set phone = excluded.phone returning id",'),
    // Deliberately bogus: the verifier must drop it (this snippet is not in the repo).
    e("orders-api", "sendgrid", "sdk", "sendgrid.send (hallucinated)", "api/src/routes/orders.ts", 'await sendgrid.send({ to: customer.email, template: "order" });'),
  ];
}

const id = (edges: CartographEdge[], from: string, to: string) => edges.find((x) => x.from === from && x.to === to)!.id;

export function chaiDraft(): DraftGraph {
  const edges = chaiDraftEdges();
  const flow = (fid: string, name: string, trigger: string, description: string, steps: Array<[string, string, string]>): CartographFlow => ({
    id: fid,
    name,
    trigger,
    description,
    steps: steps.map(([from, to, note]) => ({ edge: id(edges, from, to), note })),
  });
  return {
    stack: ["Next.js", "Express", "PostgreSQL", "Redis", "BullMQ", "Razorpay", "SendGrid", "MSG91", "Shiprocket"],
    summary:
      "A direct-to-consumer chai store: a Next.js storefront over an Express API, with Postgres for orders and inventory and Redis for caching, carts and sessions. Payments run through Razorpay, and a BullMQ worker sends receipts and books shipments after payment.",
    nodes: CHAI_NODES,
    edges,
    flows: [
      flow("place-order", "Place an order", "Shopper clicks “Pay with UPI / card”", "Checkout turns the cart into a pending order and opens a Razorpay order to pay against.", [
        ["storefront", "orders-api", "The checkout page posts the delivery address to the Orders API."],
        ["orders-api", "order-service", "The route hands off to createOrder() with the logged-in customer."],
        ["order-service", "redis", "The cart is read from the customer's Redis hash."],
        ["order-service", "postgres", "Stock is reserved and the order and its items are written in one transaction."],
        ["order-service", "razorpay", "A Razorpay order is created for the total, in paise."],
        ["order-service", "order-events", "order.created is enqueued for background work."],
      ]),
      flow("payment-confirmation", "Payment confirmation", "Razorpay captures a payment", "Razorpay's webhook marks the order paid; the worker sends the receipt and books the courier.", [
        ["razorpay", "payments-webhook", "Razorpay calls the webhook with payment.captured; the signature is verified."],
        ["payments-webhook", "payment-service", "The webhook calls markOrderPaid() with the Razorpay order id."],
        ["payment-service", "postgres", "The order flips to paid (idempotently) and reserved stock is committed."],
        ["payment-service", "order-events", "order.paid is enqueued."],
        ["order-worker", "order-events", "The worker picks up order.paid from the queue."],
        ["order-worker", "sendgrid", "A receipt email goes out through SendGrid."],
        ["order-worker", "shiprocket", "A Shiprocket shipment is booked for the address."],
      ]),
      flow("browse-catalog", "Browse the catalog", "Shopper opens the home page", "The home page lists today's blends, served from a 5-minute Redis cache.", [
        ["browser", "storefront", "The shopper loads the storefront."],
        ["storefront", "products-api", "The home page fetches the product list."],
        ["products-api", "redis", "The API returns the cached catalog when it's warm."],
        ["products-api", "postgres", "On a miss it queries products joined with inventory, then re-caches."],
      ]),
      flow("otp-login", "Log in with OTP", "Shopper enters their mobile number", "Phone + OTP login over MSG91; sessions live in Redis.", [
        ["storefront", "auth-api", "The login page asks the Auth API to send an OTP."],
        ["auth-api", "redis", "The OTP is stored in Redis for five minutes."],
        ["auth-api", "msg91", "MSG91 delivers the OTP by SMS."],
        ["auth-api", "postgres", "On verify, the customer is upserted and a session issued."],
      ]),
    ],
    agentStats: [{ agent: "fixture", durationMs: 0 }],
  };
}

export const fixtureBrain: Brain = {
  async mapRepository(snapshot, opts) {
    const p = opts?.onProgress;
    const steps: Array<[Parameters<NonNullable<typeof p>>[0], number]> = [
      [{ agent: "scout", phase: "start", message: `Scout · inspecting ${snapshot.tree.length} paths` }, 500],
      [{ agent: "scout", phase: "done", message: "Scout · found Next.js, Express, PostgreSQL, Redis, BullMQ" }, 700],
      [{ agent: "reader", phase: "start", message: "Reader 1/3 · storefront · 9 files" }, 150],
      [{ agent: "reader", phase: "start", message: "Reader 2/3 · api · 15 files" }, 150],
      [{ agent: "reader", phase: "start", message: "Reader 3/3 · worker · 4 files" }, 900],
      [{ agent: "reader", phase: "done", message: "Reader 3/3 · worker · 5 dependencies" }, 500],
      [{ agent: "reader", phase: "done", message: "Reader 1/3 · storefront · 6 dependencies" }, 600],
      [{ agent: "reader", phase: "done", message: "Reader 2/3 · api · 17 dependencies" }, 300],
      [{ agent: "cartographer", phase: "start", message: "Cartographer · organizing 28 dependencies" }, 1100],
      [{ agent: "cartographer", phase: "done", message: "Cartographer · 17 components, 27 dependencies, 4 flows" }, 200],
    ];
    if (snapshot.repo.name !== "chai-commerce" && !snapshot.repo.name.endsWith("/chai-commerce")) {
      throw new Error("The fixture brain only knows chai-commerce. Unset CARTOGRAPH_BRAIN to use the real agents.");
    }
    for (const [ev, ms] of steps) {
      p?.(ev);
      await new Promise((r) => setTimeout(r, Number(process.env.CARTOGRAPH_FIXTURE_DELAY ?? 1) * ms));
    }
    return chaiDraft();
  },

  async reviewChanges({ changes }): Promise<ReviewResult> {
    const touched = new Set(changes.filter((c) => c.status !== "deleted").map((c) => c.path));
    if (touched.has("web/lib/db.ts") || touched.has("web/app/cart/stock.ts")) {
      return {
        addNodes: [],
        addEdges: [
          {
            id: "new-1",
            from: "storefront",
            to: "postgres",
            kind: "sql",
            label: "SELECT inventory (direct)",
            evidence: [
              { path: "web/app/cart/stock.ts", line: 6, snippet: 'const { rows } = await db.query("select product_id, stock - reserved as available from inventory where product_id = any($1)", [productIds]);' },
              { path: "web/lib/db.ts", line: 4, snippet: "export const db = new Pool({ connectionString: process.env.DATABASE_URL });" },
            ],
          },
        ],
        removeEdgeIds: [],
        findings: [
          {
            severity: "critical",
            title: "Storefront now queries Postgres directly",
            detail: "The cart page's new server action opens its own pg Pool, so DATABASE_URL must now be configured in the web tier and the stock read bypasses the API's auth and caching. The Products API already returns `available`; use it.",
            nodeIds: ["storefront", "postgres"],
            edgeIds: ["new-1"],
          },
        ],
        summary: "The cart page now reads inventory straight from Postgres instead of going through the API.",
        agentStats: [{ agent: "fixture", durationMs: 0 }],
      };
    }
    return { addNodes: [], addEdges: [], removeEdgeIds: [], findings: [], summary: "", agentStats: [] };
  },

  async traceQuestion({ graph }): Promise<TraceResult> {
    return { flowId: graph.flows[0]?.id ?? null, flow: null, answer: "", agentStats: [] };
  },
};
