// JavaScript and TypeScript: React components, hooks, functions and stores,
// router routes (React Router, Next.js pages and app router), API calls and
// Express-style endpoints. Masked code + bracket matching, no compiler needed.
import { type Masked, maskTs, matchBracket } from "./lex";
import type { ElementKind, InventoryElement, InventoryLink, ParsedFile, PendingRef, SourceFile } from "./types";

export interface TsImport {
  module: string;
  /** "default", "*" or the exported name. */
  name: string;
}

export interface TsModule {
  file: string;
  imports: Map<string, TsImport>;
  /** Exported name ("default" too) → element id. */
  exports: Map<string, string>;
  /** Re-exports: exported name → { module, name }. */
  reexports: Map<string, TsImport>;
  /** Top-level names → element id. */
  locals: Map<string, string>;
}

interface Decl {
  name: string;
  start: number;
  bodyStart: number;
  end: number;
  exported: boolean;
  isDefault: boolean;
  isClass: boolean;
}

const NOT_CALLS = new Set(["if", "for", "while", "switch", "catch", "return", "function", "typeof", "new", "await", "import", "require", "super", "async"]);

function pathFromNext(file: string): { route: string; kind: "page" | "api" | "app-page" | "app-route" } | undefined {
  const f = file.replace(/^(.*\/)?src\//, "");
  let m = f.match(/^pages\/(.+)\.(tsx|jsx|ts|js)$/);
  if (m) {
    if (/^_(app|document|error)$|\/_(app|document)$/.test(m[1])) return undefined;
    const api = m[1].startsWith("api/");
    const route = "/" + m[1].replace(/(^|\/)index$/, "").replace(/\[\.\.\.(\w+)\]/g, "*").replace(/\[(\w+)\]/g, ":$1");
    return { route: route.replace(/\/$/, "") || "/", kind: api ? "api" : "page" };
  }
  m = f.match(/^app\/(.*?)(?:^|\/)?(page|route)\.(tsx|jsx|ts|js)$/);
  if (m) {
    const segs = m[1].split("/").filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith("@"));
    const route = "/" + segs.map((s) => s.replace(/^\[\.\.\.(\w+)\]$/, "*").replace(/^\[\[\.\.\.(\w+)\]\]$/, "*").replace(/^\[(\w+)\]$/, ":$1")).join("/");
    return { route: route.replace(/\/$/, "") || "/", kind: m[2] === "page" ? "app-page" : "app-route" };
  }
  return undefined;
}

function hasJsx(body: string): boolean {
  return /<\/[A-Za-z]|\/>|<>/.test(body);
}

export function parseTs(file: SourceFile, opts: { next?: boolean } = {}): ParsedFile & { module: TsModule } {
  const source = file.content;
  const m: Masked = maskTs(source);
  const code = m.code;
  const elements: InventoryElement[] = [];
  const links: InventoryLink[] = [];
  const pending: PendingRef[] = [];
  const mod: TsModule = { file: file.path, imports: new Map(), exports: new Map(), reexports: new Map(), locals: new Map() };
  const lit = (offset: number) => m.literalAt(offset)?.value;
  const at = (offset: number) => ({ file: file.path, line: m.lineAt(offset) });
  const base = file.path.split("/").pop()!.replace(/\.\w+$/, "");

  // ------------------------------------------------------------ imports
  for (const im of code.matchAll(/\bimport\s+(?:type\s+)?([\w$*{}\s,]+?)\s+from\s*(?=["'])/g)) {
    const spec = lit(im.index + im[0].length);
    if (!spec) continue;
    const clause = im[1].trim();
    const named = clause.match(/\{([^}]*)\}/)?.[1];
    const head = clause.replace(/\{[^}]*\}/, "").replace(/,/g, " ").trim();
    if (head.startsWith("*")) {
      const ns = head.match(/\*\s+as\s+([\w$]+)/)?.[1];
      if (ns) mod.imports.set(ns, { module: spec, name: "*" });
    } else if (head) mod.imports.set(head.split(/\s+/)[0], { module: spec, name: "default" });
    for (const part of named?.split(",") ?? []) {
      const p = part.replace(/^\s*type\s+/, "").trim();
      if (!p) continue;
      const [orig, alias] = p.split(/\s+as\s+/).map((s) => s.trim());
      mod.imports.set(alias ?? orig, { module: spec, name: orig });
    }
  }
  for (const r of code.matchAll(/\b(?:const|let|var)\s+([\w$]+)\s*=\s*(?:React\.)?lazy\s*\(\s*\(\)\s*=>\s*import\s*\(/g)) {
    const spec = lit(r.index + r[0].length);
    if (spec) mod.imports.set(r[1], { module: spec, name: "default" });
  }
  for (const r of code.matchAll(/\b(?:const|let|var)\s+([\w$]+)\s*=\s*require\s*\(/g)) {
    const spec = lit(r.index + r[0].length);
    if (spec) mod.imports.set(r[1], { module: spec, name: "*" });
  }
  for (const r of code.matchAll(/\bexport\s+\{([^}]*)\}\s*from\s*(?=["'])/g)) {
    const spec = lit(r.index + r[0].length);
    if (!spec) continue;
    for (const part of r[1].split(",")) {
      const [orig, alias] = part.replace(/^\s*type\s+/, "").trim().split(/\s+as\s+/).map((s) => s.trim());
      if (orig) mod.reexports.set(alias ?? orig, { module: spec, name: orig });
    }
  }
  for (const r of code.matchAll(/\bexport\s+\*\s+from\s*(?=["'])/g)) {
    const spec = lit(r.index + r[0].length);
    if (spec) mod.reexports.set(`*${mod.reexports.size}`, { module: spec, name: "*" });
  }

  // ------------------------------------------------------------ top-level declarations
  const depthAt: number[] = new Array(code.length + 1);
  {
    let d = 0;
    for (let i = 0; i < code.length; i++) {
      depthAt[i] = d;
      const ch = code[i];
      if (ch === "{" || ch === "(" || ch === "[") d++;
      else if (ch === "}" || ch === ")" || ch === "]") d = Math.max(0, d - 1);
    }
    depthAt[code.length] = d;
  }
  const statementEnd = (from: number): number => {
    // From an initializer to the end of its statement at depth 0.
    let i = from;
    const base0 = depthAt[from] ?? 0;
    while (i < code.length) {
      const ch = code[i];
      if (ch === "{" || ch === "(" || ch === "[") {
        const close = matchBracket(code, i);
        if (close < 0) return code.length;
        i = close + 1;
        continue;
      }
      if (ch === ";" && depthAt[i] === base0) return i;
      if (ch === "\n" && depthAt[i] === base0) {
        const rest = code.slice(i + 1, i + 40);
        if (/^\s*(export|const|let|var|function|class|import|type|interface|async\s+function|declare|enum|@)\b/.test(rest)) return i;
      }
      i++;
    }
    return code.length;
  };
  const decls: Decl[] = [];
  for (const f of code.matchAll(/(^|[\n;}])\s*(export\s+(default\s+)?)?(async\s+)?function\s*\*?\s*([\w$]*)\s*(?:<[^>]*>)?\s*\(/g)) {
    const start = f.index + f[1].length;
    if (depthAt[start] !== 0) continue;
    const paren = f.index + f[0].length - 1;
    const closeParen = matchBracket(code, paren);
    if (closeParen < 0) continue;
    const open = code.indexOf("{", closeParen);
    if (open < 0) continue;
    const close = matchBracket(code, open);
    if (close < 0) continue;
    const name = f[5] || (f[3] ? (/^[a-z]/.test(base) && /\.(tsx|jsx)$/.test(file.path) ? base[0].toUpperCase() + base.slice(1) : base) : "");
    if (!name) continue;
    decls.push({ name, start, bodyStart: open, end: close, exported: !!f[2], isDefault: !!f[3], isClass: false });
  }
  for (const c of code.matchAll(/(^|[\n;}])\s*(export\s+(default\s+)?)?(?:abstract\s+)?class\s+([\w$]+)[^{]*\{/g)) {
    const start = c.index + c[1].length;
    if (depthAt[start] !== 0) continue;
    const open = c.index + c[0].length - 1;
    const close = matchBracket(code, open);
    if (close < 0) continue;
    decls.push({ name: c[4], start, bodyStart: open, end: close, exported: !!c[2], isDefault: !!c[3], isClass: true });
  }
  for (const v of code.matchAll(/(^|[\n;}])\s*(export\s+)?(?:const|let|var)\s+([\w$]+)\s*(?::[^=\n]+)?=\s*/g)) {
    const start = v.index + v[1].length;
    if (depthAt[start] !== 0) continue;
    const init = v.index + v[0].length;
    const end = statementEnd(init);
    const value = code.slice(init, end);
    // Only functions, components and stores are worth listing, not every constant.
    if (!/^(async\s*)?(\([^)]*\)|[\w$]+)\s*(:[^=]+)?=>|^(async\s+)?function\b|^(React\.)?(memo|forwardRef|observer|styled|create|createSlice|createContext|createStore|defineStore|connect)\b|^\w+\s*\(\s*(\([^)]*\)|[\w$]+)\s*=>/.test(value)) continue;
    decls.push({ name: v[3], start, bodyStart: init, end, exported: !!v[2], isDefault: false, isClass: false });
  }
  for (const e of code.matchAll(/\bexport\s+default\s+(?!function|class|async)([\w$]+)\s*;?/g)) mod.exports.set("default", e[1]);
  for (const e of code.matchAll(/\bexport\s+\{([^}]*)\}(?!\s*from)/g)) {
    for (const part of e[1].split(",")) {
      const [orig, alias] = part.trim().split(/\s+as\s+/).map((s) => s.trim());
      if (orig) mod.exports.set(alias ?? orig, orig);
    }
  }
  decls.sort((a, b) => a.start - b.start);

  const next = opts.next ? pathFromNext(file.path) : undefined;
  for (const d of decls) {
    const body = code.slice(d.bodyStart, d.end + 1);
    const id = `ts:${file.path}#${d.name}`;
    let kind: ElementKind = "function";
    if (/^use[A-Z0-9]/.test(d.name)) kind = "hook";
    else if (/createSlice|createStore|defineStore|configureStore/.test(body.slice(0, 80)) || /Store$|Slice$/.test(d.name) && /\bcreate\w*\(/.test(body.slice(0, 80))) kind = "store";
    else if (/^[A-Z]/.test(d.name) && (hasJsx(body) || d.isClass && /\brender\s*\(/.test(body))) kind = "component";
    else if (/^[A-Z]/.test(d.name) && /^\s*(React\.)?(memo|forwardRef|observer|styled)\b/.test(body)) kind = "component";
    else if (/createContext/.test(body.slice(0, 60))) kind = "store";
    else if (d.isClass) continue;
    if (elements.some((e) => e.id === id)) continue;
    elements.push({ id, kind, name: d.name, file: file.path, line: m.lineAt(d.start), endLine: m.lineAt(d.end) });
    mod.locals.set(d.name, id);
    if (d.exported) mod.exports.set(d.isDefault ? "default" : d.name, id);
    if (d.isDefault) mod.exports.set("default", id);
  }
  for (const [k, v] of mod.exports) if (!v.startsWith("ts:") && mod.locals.has(v)) mod.exports.set(k, mod.locals.get(v)!);

  // ------------------------------------------------------------ bodies: renders, hooks, calls, API calls
  for (const d of decls) {
    const id = mod.locals.get(d.name);
    if (!id) continue;
    const from = d.bodyStart;
    const body = code.slice(from, d.end + 1);
    const seen = new Set<string>();
    const ref = (name: string, kind: InventoryLink["kind"], offset: number, member?: string) => {
      const key = `${kind}:${name}.${member ?? ""}`;
      if (seen.has(key) || name === d.name) return;
      seen.add(key);
      const im = mod.imports.get(name);
      if (im) pending.push({ type: "ts-ref", from: id, module: im.module, name: im.name === "*" ? (member ?? "default") : im.name, kind, ...at(offset) });
      else if (mod.locals.has(name)) links.push({ from: id, to: mod.locals.get(name)!, kind, ...at(offset) });
    };
    for (const t of body.matchAll(/<([A-Z][\w$]*)(?:\.([\w$]+))?[\s/>]/g)) ref(t[1], "renders", from + t.index, t[2]);
    for (const h of body.matchAll(/(?<![\w$.])(use[A-Z][\w$]*)\s*\(/g)) ref(h[1], "uses", from + h.index);
    for (const c of body.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)(?:\s*\.\s*([\w$]+))?\s*\(/g)) {
      if (NOT_CALLS.has(c[1]) || /^use[A-Z]/.test(c[1])) continue;
      if (c[2]) {
        if (mod.imports.get(c[1])?.name === "*" || mod.imports.get(c[1])?.name === "default") ref(c[1], "calls", from + c.index, c[2]);
      } else ref(c[1], "calls", from + c.index);
    }
    // Props passing a component: element={<Cart />} is covered above; component={Cart} here.
    for (const p of body.matchAll(/\b(?:component|Component|element)\s*[=:]\s*\{?\s*([A-Z][\w$]*)\b/g)) ref(p[1], "renders", from + p.index);
    const api = (offset: number, method: string, urlOffset: number) => {
      const url = lit(urlOffset);
      if (url === undefined) return;
      const apiId = `${id}@api:${method} ${url}`;
      if (elements.some((e) => e.id === apiId)) return;
      elements.push({ id: apiId, kind: "api-call", name: `${method} ${url}`, file: file.path, line: m.lineAt(offset), parent: id, meta: { method, url } });
      links.push({ from: id, to: apiId, kind: "calls", ...at(offset) });
      pending.push({ type: "http-call", from: apiId, method, url, ...at(offset) });
    };
    for (const f of body.matchAll(/(?<![\w$.])fetch\s*\(/g)) {
      const open = from + f.index + f[0].length - 1;
      const close = matchBracket(code, open);
      const method = source.slice(open, close > 0 ? close : open).match(/method\s*:\s*["'`](\w+)/)?.[1]?.toUpperCase() ?? "GET";
      api(from + f.index, method, open + 1);
    }
    for (const a of body.matchAll(/(?<![\w$])([\w$]+)\s*\.\s*(get|post|put|patch|delete)\s*(?:<[^>()]*>)?\s*\(/g)) {
      if (!/^(axios|api|http|client|instance|request|ky|\w*(Api|API|Client|Http|http|api))$/.test(a[1])) continue;
      api(from + a.index, a[2].toUpperCase(), from + a.index + a[0].length);
    }
    for (const s of body.matchAll(/(?<![\w$.])(useSWR|useFetch|useAxios)\s*(?:<[^>()]*>)?\s*\(/g)) api(from + s.index, "GET", from + s.index + s[0].length);
  }

  // ------------------------------------------------------------ routes
  const routeEl = (path: string, offset: number, target?: string, member?: string) => {
    const rid = `route:${path}@${file.path}:${m.lineAt(offset)}`;
    if (elements.some((e) => e.id === rid)) return;
    elements.push({ id: rid, kind: "route", name: path, file: file.path, line: m.lineAt(offset), meta: { path } });
    if (target) {
      const im = mod.imports.get(target);
      if (im) pending.push({ type: "ts-ref", from: rid, module: im.module, name: im.name === "*" ? (member ?? "default") : im.name, kind: "renders", ...at(offset) });
      else if (mod.locals.has(target)) links.push({ from: rid, to: mod.locals.get(target)!, kind: "renders", ...at(offset) });
    }
  };
  for (const r of code.matchAll(/<Route\b/g)) {
    let k = r.index + 6;
    let depth = 0;
    while (k < code.length) {
      if (code[k] === "{") depth++;
      else if (code[k] === "}") depth--;
      else if (code[k] === ">" && depth === 0) break;
      k++;
    }
    const tag = code.slice(r.index, k);
    const pathAt = tag.search(/\bpath\s*=\s*["'{]/);
    const isIndex = /\bindex\b/.test(tag);
    if (pathAt < 0 && !isIndex) continue;
    const path = pathAt >= 0 ? lit(r.index + pathAt + tag.slice(pathAt).indexOf("=") + 1) ?? lit(r.index + pathAt + tag.slice(pathAt).indexOf("{") + 1) : "(index)";
    if (!path) continue;
    const target = tag.match(/\belement\s*=\s*\{\s*<([A-Z][\w$]*)/)?.[1] ?? tag.match(/\b(?:component|Component)\s*=\s*\{\s*([A-Z][\w$]*)/)?.[1];
    routeEl(path, r.index, target);
  }
  for (const p of code.matchAll(/\bpath\s*:\s*(?=["'`])/g)) {
    const path = lit(p.index + p[0].length);
    if (path === undefined || !/^[/:*\w-]/.test(path) && path !== "") continue;
    // The object this path belongs to: up to the next path or 400 characters.
    const window = code.slice(p.index, p.index + 400).split(/\bpath\s*:/)[1] ?? "";
    const rest = code.slice(p.index + p[0].length, p.index + p[0].length + window.length);
    const target = rest.match(/\belement\s*:\s*<\s*([A-Z][\w$]*)/)?.[1] ?? rest.match(/\b(?:Component|component)\s*:\s*([A-Z][\w$]*)/)?.[1];
    const lazy = rest.match(/\blazy\s*:\s*\(\)\s*=>\s*import\s*\(/);
    if (!target && !lazy && !/children\s*:/.test(rest)) continue;
    if (lazy) {
      const spec = lit(p.index + p[0].length + (lazy.index ?? 0) + lazy[0].length);
      const rid = `route:${path || "/"}@${file.path}:${m.lineAt(p.index)}`;
      elements.push({ id: rid, kind: "route", name: path || "/", file: file.path, line: m.lineAt(p.index), meta: { path: path || "/" } });
      if (spec) pending.push({ type: "ts-ref", from: rid, module: spec, name: "default", kind: "renders", ...at(p.index) });
    } else routeEl(path || "/", p.index, target);
  }
  if (next) {
    if (next.kind === "page" || next.kind === "app-page") {
      const rid = `route:${next.route}@${file.path}`;
      elements.push({ id: rid, kind: "route", name: next.route, file: file.path, line: 1, meta: { path: next.route, router: "next" } });
      const target = mod.exports.get("default");
      if (target) links.push({ from: rid, to: target, kind: "renders", file: file.path, line: elements.find((e) => e.id === target)?.line ?? 1 });
    } else {
      const verbs = next.kind === "api" ? ["ANY"] : [...code.matchAll(/\bexport\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)].map((x) => x[1]);
      for (const verb of verbs.length ? verbs : ["ANY"]) {
        const eid = `ts:${file.path}#endpoint:${verb} ${next.route}`;
        const handler = mod.locals.get(verb) ?? mod.exports.get("default");
        elements.push({ id: eid, kind: "endpoint", name: `${verb} ${next.route}`, file: file.path, line: handler ? elements.find((e) => e.id === handler)?.line ?? 1 : 1, meta: { methods: [verb], http: [`${verb} ${next.route}`] } });
        if (handler) links.push({ from: eid, to: handler, kind: "calls", file: file.path, line: 1 });
      }
    }
  }
  // Express, Fastify, Koa and Hono style servers.
  for (const e of code.matchAll(/(?<![\w$.])(app|router|server|fastify|\w+Router|\w+Routes)\s*\.\s*(get|post|put|patch|delete|all)\s*\(\s*(?=["'`])/g)) {
    const path = lit(e.index + e[0].length);
    if (!path || !path.startsWith("/")) continue;
    const verb = e[2] === "all" ? "ANY" : e[2].toUpperCase();
    const eid = `ts:${file.path}#endpoint:${verb} ${path}`;
    if (elements.some((x) => x.id === eid)) continue;
    elements.push({ id: eid, kind: "endpoint", name: `${verb} ${path}`, file: file.path, line: m.lineAt(e.index), meta: { methods: [verb], http: [`${verb} ${path}`] } });
    const open = code.indexOf("(", e.index);
    const close = matchBracket(code, open);
    const args = close > 0 ? code.slice(open + 1, close) : "";
    for (const h of args.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)(?:\s*\.\s*([\w$]+))?(?=\s*[,)]|\s*$)/g)) {
      const name = h[1];
      const im = mod.imports.get(name);
      if (im) pending.push({ type: "ts-ref", from: eid, module: im.module, name: im.name === "*" ? (h[2] ?? "default") : im.name, kind: "calls", ...at(e.index) });
      else if (mod.locals.has(name)) links.push({ from: eid, to: mod.locals.get(name)!, kind: "calls", ...at(e.index) });
    }
  }
  // The app root, for single-page apps with no router: createRoot(...).render(<App />).
  for (const r of code.matchAll(/\b(?:createRoot|hydrateRoot|ReactDOM\.render)\s*\([\s\S]{0,200}?<([A-Z][\w$]*)/g)) {
    if (elements.some((e) => e.kind === "route")) break;
    routeEl("/", r.index, r[1]);
    const root = elements.find((e) => e.kind === "route" && e.line === m.lineAt(r.index));
    if (root) root.meta = { ...root.meta, appRoot: "true" };
  }
  return { elements, links, pending, module: mod };
}
