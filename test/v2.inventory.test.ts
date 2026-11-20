import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildInventory } from "../src/v2/inventory";
import { humanize, maskTs } from "../src/v2/inventory/lex";
import type { Inventory } from "../src/v2/inventory/types";

const FIXTURES = path.join(__dirname, "fixtures", "v2");

function load(name: string) {
  const root = path.join(FIXTURES, name);
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(path.join(d, f)).isDirectory() ? walk(path.join(d, f)) : [path.join(d, f)]));
  return walk(root).map((p) => ({ path: path.relative(root, p), content: readFileSync(p, "utf8") }));
}

const has = (inv: Inventory, from: string, to: string, kind?: string) =>
  inv.links.some((l) => l.from === from && l.to === to && (!kind || l.kind === kind));
const el = (inv: Inventory, id: string) => inv.elements.find((e) => e.id === id);

describe("SAP Commerce Accelerator inventory", () => {
  const inv = buildInventory("acme", "sha", load("accelerator"));
  const W = "hybris/bin/custom/acmestorefront/web/webroot/WEB-INF";
  const cartJsp = `jsp:${W}/views/responsive/pages/cart/cartPage.jsp`;
  const showCart = "java:com.acme.storefront.controllers.pages.CartPageController#showCart";
  const applyVoucher = "java:com.acme.storefront.controllers.pages.CartPageController#applyVoucher";

  it("detects the stack", () => {
    expect(inv.stack).toEqual(expect.arrayContaining(["SAP Commerce", "Accelerator storefront", "Spring", "JSP"]));
  });

  it("lists every entry point and nothing else", () => {
    expect(new Set(inv.entryPoints)).toEqual(new Set([
      showCart, applyVoucher,
      "cronjob:cartCleanupCronJob", "process:order-process", "java:com.acme.core.event.OrderConfirmationEventListener",
    ]));
  });

  it("builds endpoint paths from class and method mappings, constants included", () => {
    expect(el(inv, showCart)?.meta?.http).toEqual(["GET /cart"]);
    expect(el(inv, applyVoucher)?.meta?.http).toEqual(["POST /cart/voucher/apply"]);
  });

  it("follows a Spring alias override to the project facade", () => {
    expect(has(inv, showCart, "java:com.acme.facades.cart.AcmeCartFacade#getSessionCart", "calls")).toBe(true);
    expect(has(inv, "java:com.acme.facades.cart.AcmeCartFacade#getSessionCart", "java:com.acme.facades.cart.DefaultCartFacade#getSessionCart", "calls")).toBe(true);
  });

  it("walks controller → facade → service → DAO through getters and XML wiring", () => {
    expect(has(inv, applyVoucher, "java:com.acme.facades.voucher.DefaultVoucherFacade#applyVoucher", "calls")).toBe(true);
    expect(has(inv, "java:com.acme.facades.voucher.DefaultVoucherFacade#applyVoucher", "java:com.acme.core.voucher.DefaultVoucherService#redeemVoucher", "calls")).toBe(true);
    expect(has(inv, "java:com.acme.core.voucher.DefaultVoucherService#redeemVoucher", "java:com.acme.core.voucher.DefaultVoucherDao#findVoucher", "calls")).toBe(true);
  });

  it("resolves view names built from nested constants, and the CMS page a controller loads", () => {
    expect(has(inv, showCart, cartJsp, "renders")).toBe(true);
    expect(has(inv, showCart, "cms-page:cartPage", "uses")).toBe(true);
  });

  it("is not fooled by braces and returns inside strings and comments", () => {
    expect(el(inv, showCart)!.endLine!).toBeLessThan(el(inv, applyVoucher)!.line);
  });

  it("maps CMS data: page → template → JSP, page → slot → component → controller and JSP", () => {
    expect(has(inv, "cms-page:cartPage", "cms-template:CartPageTemplate", "uses")).toBe(true);
    expect(has(inv, "cms-template:CartPageTemplate", cartJsp, "renders")).toBe(true);
    expect(has(inv, "cms-page:cartPage", "cms-slot:TopContentSlot-cartPage", "places")).toBe(true);
    expect(has(inv, "cms-slot:TopContentSlot-cartPage", "cms-component:CartCarousel", "places")).toBe(true);
    expect(has(inv, "cms-component:CartCarousel", "java:com.acme.storefront.controllers.cms.ProductCarouselComponentController", "uses")).toBe(true);
    expect(has(inv, "cms-component:CartCarousel", `jsp:${W}/views/responsive/cms/productcarouselcomponent.jsp`, "renders")).toBe(true);
    expect(inv.elements.filter((e) => e.kind === "cms-page").map((e) => e.id)).toEqual(["cms-page:cartPage"]);
  });

  it("links JSP tags, and forms to the endpoint they post to", () => {
    expect(has(inv, cartJsp, `jsp:${W}/tags/responsive/cart/cartItems.tag`, "includes")).toBe(true);
    expect(has(inv, cartJsp, applyVoucher, "http")).toBe(true);
    expect(el(inv, cartJsp)?.meta?.slots).toEqual(["TopContent"]);
  });

  it("connects cronjobs, business processes, listeners and populators", () => {
    expect(has(inv, "cronjob:cartCleanupCronJob", "java:com.acme.core.jobs.CartCleanupJob", "runs")).toBe(true);
    expect(el(inv, "cronjob:cartCleanupCronJob")?.meta?.schedule).toBe("0 0 3 * * ?");
    expect(has(inv, "process:order-process", "bean:sendOrderConfirmationEmail", "runs")).toBe(true);
    expect(has(inv, "bean:sendOrderConfirmationEmail", "java:com.acme.core.actions.SendOrderConfirmationEmailAction", "defines")).toBe(true);
    expect(has(inv, "java:com.acme.core.event.OrderConfirmationEventListener#onSiteEvent", "process:order-process", "runs")).toBe(true);
    expect(has(inv, "bean:cartConverter", "bean:acmeCartPopulator", "populates")).toBe(true);
  });

  it("reads the type system and extension structure", () => {
    expect(el(inv, "item:Voucher")?.meta?.attributes).toEqual(["code: java.lang.String", "redeemed: java.lang.Boolean"]);
    expect(has(inv, "ext:acmestorefront", "ext:acmefacades", "requires")).toBe(true);
  });

  it("lists code it can't read as unread, and leaves test code out", () => {
    expect(inv.files.filter((f) => f.status === "unread").map((f) => f.path)).toEqual(["hybris/bin/custom/acmecore/resources/acmecore/email/orderConfirmation.vm"]);
    expect(inv.files.some((f) => f.path.includes("testsrc"))).toBe(false);
  });
});

describe("React + Spring Boot inventory", () => {
  const inv = buildInventory("shop", "sha", load("shop"));
  it("lists routes and what they render", () => {
    const routes = inv.elements.filter((e) => e.kind === "route").map((e) => e.name).sort();
    expect(routes).toEqual(["/", "/cart", "/orders/:id"]);
    expect(has(inv, "route:/cart@web/src/App.tsx:14", "ts:web/src/pages/CartPage.tsx#CartPage", "renders")).toBe(true);
  });

  it("follows components, hooks and API modules to the backend endpoint", () => {
    expect(has(inv, "ts:web/src/pages/CartPage.tsx#CartPage", "ts:web/src/components/VoucherForm.tsx#VoucherForm", "renders")).toBe(true);
    expect(has(inv, "ts:web/src/pages/CartPage.tsx#CartPage", "ts:web/src/hooks/useCart.ts#useCart", "uses")).toBe(true);
    expect(has(inv, "ts:web/src/hooks/useCart.ts#useCart", "ts:web/src/api/cart.ts#getCart", "calls")).toBe(true);
    expect(has(inv, "ts:web/src/api/cart.ts#getCart@api:GET ${API}/api/cart", "ts:server/routes.ts#endpoint:GET /api/cart", "http")).toBe(true);
    expect(has(inv, "ts:server/routes.ts#endpoint:POST /api/cart/voucher", "ts:server/cart.ts#redeem", "calls")).toBe(true);
  });

  it("links a fetch in React to the Spring controller that serves it", () => {
    expect(has(inv, "ts:web/src/pages/OrderPage.tsx#OrderPage@api:GET /api/orders/${id}", "java:com.shop.orders.OrderController#getOrder", "http")).toBe(true);
    expect(has(inv, "java:com.shop.orders.OrderController#getOrder", "java:com.shop.orders.OrderService#find", "calls")).toBe(true);
  });

  it("treats schedules and message listeners as entry points", () => {
    expect(inv.entryPoints).toEqual(expect.arrayContaining(["java:com.shop.orders.OrderService#expireStaleOrders", "java:com.shop.orders.OrderService#onPayment"]));
    expect(inv.files.some((f) => /\.test\.tsx$|src\/test\//.test(f.path))).toBe(false);
  });
});

describe("Next.js routes", () => {
  const inv = buildInventory("next", "sha", [
    { path: "package.json", content: '{"dependencies":{"next":"15.0.0","react":"19.0.0"}}' },
    { path: "app/(shop)/cart/page.tsx", content: "export default function Cart() { return <div/>; }" },
    { path: "app/api/cart/[id]/route.ts", content: "export async function GET() { return Response.json({}); }\nexport async function DELETE() { return new Response(); }" },
    { path: "pages/orders/[id].tsx", content: "export default function Order() { return <p>order</p>; }" },
  ]);
  it("turns app and pages files into routes and endpoints", () => {
    expect(inv.elements.filter((e) => e.kind === "route").map((e) => e.name).sort()).toEqual(["/cart", "/orders/:id"]);
    expect(inv.elements.filter((e) => e.kind === "endpoint").map((e) => e.name).sort()).toEqual(["DELETE /api/cart/:id", "GET /api/cart/:id"]);
    expect(has(inv, "route:/cart@app/(shop)/cart/page.tsx", "ts:app/(shop)/cart/page.tsx#Cart", "renders")).toBe(true);
  });
});

describe("lexer", () => {
  it("keeps JSX apostrophes from opening strings", () => {
    const m = maskTs("const A = () => <p>Don't stop</p>;\nconst b = 'x{';\n");
    expect(m.code).toContain("<p>Don't stop</p>");
    expect(m.code).not.toContain("x{");
  });
  it("masks regex literals and templates", () => {
    const m = maskTs("const r = /[{}]/g; const t = `a ${b} {`;");
    expect(m.code.includes("{}")).toBe(false);
    expect(m.literals.map((l) => l.value)).toContain("a ${b} {");
  });
  it("humanizes code names", () => {
    expect(humanize("applyVoucher")).toBe("Apply voucher");
    expect(humanize("CartPageController")).toBe("Cart page controller");
  });
});
