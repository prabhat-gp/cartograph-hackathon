// JSP pages and tag files: which tags and includes a page uses, its CMS slots,
// the model attributes it reads and the URLs its forms and links call.
import type { InventoryElement, ParsedFile, PendingRef, SourceFile } from "./types";

const EL_SKIP = new Set(["fn", "not", "empty", "pageContext", "param", "header", "cookie", "requestScope", "sessionScope", "applicationScope", "initParam", "true", "false", "null", "and", "or", "eq", "ne"]);

/** "…/WEB-INF/views/responsive/pages/cart/cartPage.jsp" → "pages/cart/cartPage". */
export function viewName(path: string): string | undefined {
  const m = path.match(/\/WEB-INF\/views\/(?:[^/]+\/)?(.+)\.jspf?$/) ?? path.match(/\/(?:views|templates)\/(.+)\.(?:jspf?|html)$/);
  return m?.[1];
}

/**
 * Thymeleaf (and similar) server templates under templates/: the fragments they
 * include and the URLs their links and forms call. Listed as pages, like JSPs.
 */
export function parseTemplate(file: SourceFile): ParsedFile {
  const text = file.content.replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, " "));
  const lineAt = (o: number) => text.slice(0, o).split("\n").length;
  const id = `jsp:${file.path}`;
  const pending: PendingRef[] = [];
  const view = viewName(file.path);
  const root = file.path.slice(0, file.path.indexOf("/templates/") + "/templates/".length);
  const seen = new Set<string>();
  for (const f of text.matchAll(/th:(?:replace|insert|include)\s*=\s*"~?\{?\s*([\w/.-]+)\s*(?:::|\})/g)) {
    if (seen.has(f[1])) continue;
    seen.add(f[1]);
    pending.push({ type: "jsp-include", from: id, target: `/${root}${f[1]}.html`, file: file.path, line: lineAt(f.index) });
  }
  for (const u of text.matchAll(/th:(href|action|src)\s*=\s*"@\{([^}(?]+)/g)) {
    const url = u[2].replace(/\$\{[^}]*\}/g, "*").trim();
    if (!url.startsWith("/") || seen.has(url)) continue;
    seen.add(url);
    const method = u[1] === "action" ? (text.slice(Math.max(0, u.index - 200), u.index + 200).match(/method\s*=\s*"(\w+)"/)?.[1] ?? "POST").toUpperCase() : "ANY";
    pending.push({ type: "http-call", from: id, method, url, file: file.path, line: lineAt(u.index) });
  }
  const model = [...new Set([...text.matchAll(/\$\{\s*([A-Za-z_]\w*)/g)].map((v) => v[1]).filter((v) => !EL_SKIP.has(v)))].slice(0, 40);
  const meta: Record<string, string | string[]> = {};
  if (view) meta.view = view;
  if (model.length) meta.model = model;
  return { elements: [{ id, kind: "jsp-page", name: view ?? file.path, file: file.path, line: 1, endLine: text.split("\n").length, meta: { ...meta, engine: "thymeleaf" } }], links: [], pending };
}

export function parseJsp(file: SourceFile): ParsedFile {
  const text = file.content.replace(/<%--[\s\S]*?--%>/g, (c) => c.replace(/[^\n]/g, " "));
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  const lineAt = (o: number) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= o) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  const isTag = /\.tagx?$/.test(file.path);
  const id = `jsp:${file.path}`;
  const pending: PendingRef[] = [];
  const tagdirs = new Map<string, string>();
  for (const t of text.matchAll(/<%@\s*taglib\s+([^%]*)%>/g)) {
    const prefix = t[1].match(/prefix\s*=\s*"([^"]+)"/)?.[1];
    const dir = t[1].match(/tagdir\s*=\s*"([^"]+)"/)?.[1];
    if (prefix && dir) tagdirs.set(prefix, dir.replace(/\/$/, ""));
  }
  const usedTags = new Set<string>();
  for (const t of text.matchAll(/<([\w-]+):([\w-]+)\b/g)) {
    const dir = tagdirs.get(t[1]);
    if (!dir || usedTags.has(`${t[1]}:${t[2]}`)) continue;
    usedTags.add(`${t[1]}:${t[2]}`);
    pending.push({ type: "jsp-tag", from: id, tagdir: dir, tag: t[2], file: file.path, line: lineAt(t.index) });
  }
  for (const inc of text.matchAll(/<%@\s*include\s+file\s*=\s*"([^"]+)"|<jsp:include\s+page\s*=\s*"([^"$]+)"/g)) {
    pending.push({ type: "jsp-include", from: id, target: inc[1] ?? inc[2], file: file.path, line: lineAt(inc.index) });
  }
  const slots = [...new Set([...text.matchAll(/<cms:pageSlot\s[^>]*position\s*=\s*"([^"]+)"/g)].map((s) => s[1]))];
  const model = [...new Set([...text.matchAll(/\$\{\s*!?\s*([A-Za-z_]\w*)/g)].map((v) => v[1]).filter((v) => !EL_SKIP.has(v)))].slice(0, 40);
  const urls = new Set<string>();
  for (const u of text.matchAll(/<(?:c|spring):url\s+[^>]*value\s*=\s*"(\/[^"$]*)"|<(?:form:)?form\s[^>]*action\s*=\s*"(\/[^"$]*)"/g)) {
    const url = (u[1] ?? u[2]).split("?")[0];
    if (!url || urls.has(url)) continue;
    urls.add(url);
    const method = u[2] ? (u[0].match(/method\s*=\s*"(\w+)"/)?.[1] ?? "POST").toUpperCase() : "ANY";
    pending.push({ type: "http-call", from: id, method, url, file: file.path, line: lineAt(u.index) });
  }
  const view = viewName(file.path);
  const meta: Record<string, string | string[]> = {};
  if (view) meta.view = view;
  if (slots.length) meta.slots = slots;
  if (model.length) meta.model = model;
  const name = file.path.split("/").pop()!.replace(/\.(jspf?|tagx?)$/, "");
  const element: InventoryElement = { id, kind: isTag ? "jsp-tag" : "jsp-page", name: view ?? name, file: file.path, line: 1, endLine: starts.length, ...(Object.keys(meta).length ? { meta } : {}) };
  return { elements: [element], links: [], pending };
}
