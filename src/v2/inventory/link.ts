// The linker: turns each parser's pending references into links between
// elements, across files. Java calls go through interfaces to their Spring
// implementation (bean names and aliases win, as they do at runtime), view
// names built from constants reach their JSP, CMS data reaches its
// controllers and templates, React imports reach their modules, and HTTP
// calls from the front end reach the endpoint that serves them.
import path from "node:path";
import type { JavaType, JavaUnit } from "./java";
import type { TsModule } from "./react";
import type { InventoryElement, InventoryLink, LinkKind, PendingRef } from "./types";

export interface LinkInput {
  elements: InventoryElement[];
  links: InventoryLink[];
  pending: PendingRef[];
  javaUnits: JavaUnit[];
  tsModules: TsModule[];
  /** Every path in the repo, for resolving imports. */
  paths: Set<string>;
}

const lowerFirst = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);

/** "/cart/{entryNumber}/update" → ["cart", "*", "update"]. */
export function pathSegments(p: string): string[] {
  return p
    .replace(/^[a-z]+:\/\/[^/]+/i, "")
    .split("?")[0]
    .split("#")[0]
    .split("/")
    .filter(Boolean)
    .map((s) => (/^(\{.*\}|:\w.*|\*+|\$\{.*\}|\[.*\])$/.test(s) || s.includes("${") ? "*" : s.toLowerCase()));
}

export function linkInventory(input: LinkInput): { elements: InventoryElement[]; links: InventoryLink[]; unresolvedCalls: number } {
  // ------------------------------------------------------------ elements, deduplicated
  const byId = new Map<string, InventoryElement>();
  for (const el of input.elements) {
    const prev = byId.get(el.id);
    if (!prev) {
      byId.set(el.id, el);
      continue;
    }
    if (el.kind === "bean") {
      // A later bean definition with the same id overrides the earlier one, as in Spring.
      byId.set(el.id, { ...el, meta: { ...el.meta, overrides: `${prev.file}:${prev.line}` } });
    } else if (el.kind.startsWith("cms-") || el.kind === "cronjob" || el.kind === "item-type") {
      prev.meta = { ...el.meta, ...prev.meta, alsoIn: [...new Set([...((prev.meta?.alsoIn as string[]) ?? []), `${el.file}:${el.line}`])].slice(0, 10) };
    }
  }
  const links: InventoryLink[] = [...input.links];
  const linkKeys = new Set(links.map((l) => `${l.from}>${l.to}>${l.kind}`));
  const link = (from: string, to: string, kind: LinkKind, file: string, line: number) => {
    if (from === to || !byId.has(from) || !byId.has(to)) return false;
    const key = `${from}>${to}>${kind}`;
    if (linkKeys.has(key)) return true;
    linkKeys.add(key);
    links.push({ from, to, kind, file, line });
    return true;
  };

  // ------------------------------------------------------------ Java type index
  const types = new Map<string, JavaType>();
  const bySimple = new Map<string, JavaType[]>();
  const unitOf = new Map<string, JavaUnit>();
  for (const u of input.javaUnits) {
    unitOf.set(u.file, u);
    for (const t of u.types) {
      types.set(t.fqn, t);
      bySimple.set(t.name, [...(bySimple.get(t.name) ?? []), t]);
    }
  }
  const typeById = new Map([...types.values()].map((t) => [t.id, t]));
  const resolveType = (name: string, file: string, ctx?: JavaType): JavaType | undefined => {
    const clean = name.replace(/<.*$/, "").replace(/\[\]$/, "").trim();
    if (!clean) return undefined;
    if (types.has(clean)) return types.get(clean);
    const unit = unitOf.get(file);
    const [head, ...rest] = clean.split(".");
    const tail = rest.length ? `.${rest.join(".")}` : "";
    // Nested in the current type or its outers.
    for (let t: JavaType | undefined = ctx; t; t = t.outer ? types.get(t.outer) : undefined) {
      const nested = types.get(`${t.fqn}.${clean}`);
      if (nested) return nested;
    }
    if (unit) {
      const imported = unit.imports.get(head);
      if (imported && types.has(imported + tail)) return types.get(imported + tail);
      if (types.has(`${unit.pkg}.${clean}`)) return types.get(`${unit.pkg}.${clean}`);
      for (const w of unit.wildcards) if (types.has(`${w}.${clean}`)) return types.get(`${w}.${clean}`);
      if (imported) return undefined; // imported from a library
    }
    const candidates = bySimple.get(clean.split(".").pop()!) ?? [];
    return candidates.length === 1 ? candidates[0] : undefined;
  };
  const superOf = (t: JavaType): JavaType | undefined => (t.declKind === "class" && t.extends[0] ? resolveType(t.extends[0], t.file, t) : undefined);
  const interfacesOf = (t: JavaType): JavaType[] => {
    const out: JavaType[] = [];
    const visit = (x: JavaType, depth: number) => {
      if (depth > 8) return;
      for (const name of x.declKind === "interface" ? x.extends : x.implements) {
        const it = resolveType(name, x.file, x);
        if (it && !out.includes(it)) {
          out.push(it);
          visit(it, depth + 1);
        }
      }
      const sup = superOf(x);
      if (sup) visit(sup, depth + 1);
    };
    visit(t, 0);
    return out;
  };
  const implementors = new Map<string, JavaType[]>();
  for (const t of types.values()) {
    if (t.declKind !== "class") continue;
    for (const it of interfacesOf(t)) implementors.set(it.fqn, [...(implementors.get(it.fqn) ?? []), t]);
    for (let s = superOf(t), d = 0; s && d < 8; s = superOf(s), d++) implementors.set(s.fqn, [...(implementors.get(s.fqn) ?? []), t]);
  }

  // ------------------------------------------------------------ beans
  const aliases = new Map<string, string>();
  for (const p of input.pending) if (p.type === "bean-alias") aliases.set(p.alias, p.bean); // last definition wins
  const beanClass = new Map<string, JavaType>();
  for (const p of input.pending) if (p.type === "bean-class") {
    const t = types.get(p.className) ?? resolveType(p.className, p.file);
    if (t && byId.get(p.from)?.kind === "bean") beanClass.set(p.from.slice(5), t);
  }
  // Annotated components are beans too: @Service("x"), or the class name with a lower-case first letter.
  for (const t of types.values()) {
    const named = t.annotations.find((a) => ["Component", "Service", "Repository", "Controller", "RestController"].includes(a.name));
    if (!named) continue;
    const id = named.args.match(/"([^"]+)"/)?.[1] ?? lowerFirst(t.name);
    if (!beanClass.has(id)) beanClass.set(id, t);
  }
  const resolveBean = (name: string): string | undefined => {
    let cur = name;
    for (let i = 0; i < 10 && aliases.has(cur) && aliases.get(cur) !== cur; i++) cur = aliases.get(cur)!;
    return cur;
  };
  const classOfBean = (name: string): JavaType | undefined => {
    let cur = resolveBean(name);
    for (let i = 0; cur && i < 10; i++) {
      if (beanClass.has(cur)) return beanClass.get(cur);
      cur = byId.get(`bean:${cur}`)?.meta?.parent as string | undefined;
      if (cur) cur = resolveBean(cur);
    }
    return undefined;
  };

  /** The classes that actually run when code calls a value of this type. */
  const implementationsOf = (t: JavaType | undefined, bean?: string): JavaType[] => {
    if (bean) {
      const viaBean = classOfBean(bean);
      if (viaBean) return [viaBean];
    }
    if (!t) return [];
    if (t.declKind !== "interface" && !/^Abstract/.test(t.name)) return [t];
    const impls = implementors.get(t.fqn) ?? [];
    if (impls.length === 1) return impls;
    const conventional = classOfBean(lowerFirst(t.name));
    if (conventional) return [conventional];
    return impls.length ? impls.slice(0, 4) : [t];
  };
  const methodsNamed = (t: JavaType, name: string): string[] => {
    for (let cur: JavaType | undefined = t, d = 0; cur && d < 10; cur = superOf(cur), d++) {
      const found = cur.methods.filter((m) => m.name === name).map((m) => m.id);
      if (found.length) return found.slice(0, 3);
    }
    for (const it of interfacesOf(t)) {
      const found = it.methods.filter((m) => m.name === name).map((m) => m.id);
      if (found.length) return found.slice(0, 1);
    }
    return [];
  };
  const fieldIn = (t: JavaType, name: string) => {
    for (let cur: JavaType | undefined = t, d = 0; cur && d < 10; cur = superOf(cur), d++) {
      const f = cur.fields.get(name);
      if (f) return { field: f, owner: cur };
    }
    return undefined;
  };
  const methodOwner = (methodId: string) => typeById.get(methodId.replace(/#.*$/, ""));

  // ------------------------------------------------------------ constants
  const constantKeys: string[] = [];
  for (const t of types.values()) for (const k of t.constants.keys()) constantKeys.push(`${t.fqn}.${k}`);
  const evaluate = (expr: string, ctx: JavaType | undefined, depth = 0): string => {
    if (depth > 6) return "";
    let out = "";
    const tokens = expr.match(/"(?:[^"\\]|\\.)*"|[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*\s*(?:\()?|\+|[^\s+]/g) ?? [];
    for (const raw of tokens) {
      const tok = raw.trim();
      if (tok === "+") continue;
      if (tok.startsWith('"')) {
        out += tok.slice(1, -1).replace(/\\(.)/g, "$1");
        continue;
      }
      if (tok.endsWith("(")) return out + "{call}"; // a method call: not a constant
      if (!/^[A-Za-z_$]/.test(tok)) continue;
      const ref = tok.replace(/\s+/g, "");
      const value = constantValue(ref, ctx, depth);
      out += value ?? `{${ref}}`;
    }
    return out;
  };
  const constantValue = (ref: string, ctx: JavaType | undefined, depth: number): string | undefined => {
    if (!ref.includes(".")) {
      const visit: JavaType[] = [];
      for (let t = ctx; t; t = t.outer ? types.get(t.outer) : undefined) visit.push(t);
      if (ctx) {
        for (let s = superOf(ctx), d = 0; s && d < 8; s = superOf(s), d++) visit.push(s);
        visit.push(...interfacesOf(ctx));
      }
      for (const t of visit) if (t.constants.has(ref)) return evaluate(t.constants.get(ref)!, t, depth + 1);
      return undefined;
    }
    const parts = ref.split(".");
    const name = parts.pop()!;
    const owner = ctx ? resolveType(parts.join("."), ctx.file, ctx) : undefined;
    if (owner?.constants.has(name)) return evaluate(owner.constants.get(name)!, owner, depth + 1);
    const key = constantKeys.find((k) => k.endsWith(`.${ref}`));
    if (key) {
      const t = types.get(key.slice(0, key.lastIndexOf(".")))!;
      return evaluate(t.constants.get(name)!, t, depth + 1);
    }
    return undefined;
  };

  // ------------------------------------------------------------ endpoint paths
  const joinPaths = (a: string, b: string) => ("/" + [a, b].map((s) => s.replace(/^\/+|\/+$/g, "")).filter(Boolean).join("/")).replace(/\/+/g, "/");
  for (const el of byId.values()) {
    if (el.kind !== "endpoint" || !el.id.startsWith("java:") || !el.meta?.mapping) continue;
    const owner = methodOwner(el.id);
    const methodPaths = (el.meta.mapping as string[]).map((e) => evaluate(e, owner));
    const classPaths = ((el.meta.classMapping as string[] | undefined) ?? [""]).map((e) => (e ? evaluate(e, owner) : ""));
    const http: string[] = [];
    for (const c of classPaths) for (const p of methodPaths) for (const verb of el.meta.methods as string[]) http.push(`${verb} ${joinPaths(c, p)}`);
    el.meta = { ...el.meta, http: [...new Set(http)].slice(0, 12) };
  }

  // ------------------------------------------------------------ views and JSP files
  const jsps = [...byId.values()].filter((e) => e.kind === "jsp-page" || e.kind === "jsp-tag");
  const jspByView = new Map<string, InventoryElement>();
  for (const j of jsps) if (j.meta?.view) jspByView.set((j.meta.view as string).toLowerCase(), j);
  const jspForView = (view: string): InventoryElement | undefined => {
    const v = view.replace(/^\/+/, "").replace(/\.jspf?$/, "").toLowerCase();
    return jspByView.get(v) ?? jsps.find((j) => j.file.toLowerCase().endsWith(`/${v}.jsp`) || j.file.toLowerCase().endsWith(`/templates/${v}.html`));
  };
  const cmsByUid = new Map<string, InventoryElement>();
  for (const el of byId.values()) {
    if (el.kind === "cms-page") {
      cmsByUid.set(`page:${String(el.meta?.uid).toLowerCase()}`, el);
      if (el.meta?.label) cmsByUid.set(`label:${String(el.meta.label).toLowerCase()}`, el);
    }
  }

  // ------------------------------------------------------------ TypeScript modules
  const modules = new Map(input.tsModules.map((m) => [m.file, m]));
  const TS_EXT = ["", ".tsx", ".ts", ".jsx", ".js", ".mjs", ".cjs", "/index.tsx", "/index.ts", "/index.jsx", "/index.js"];
  const resolveModule = (spec: string, fromFile: string): TsModule | undefined => {
    const roots: string[] = [];
    if (spec.startsWith(".")) roots.push(path.posix.join(path.posix.dirname(fromFile), spec));
    else if (/^[@~#]\//.test(spec)) {
      const rest = spec.slice(2);
      // Alias to the nearest src/ above the importer, or the repo root.
      const parts = fromFile.split("/");
      for (let i = parts.length - 1; i >= 0; i--) if (parts[i] === "src") roots.push([...parts.slice(0, i + 1), rest].join("/"));
      roots.push(`src/${rest}`, rest);
    } else if (!spec.startsWith("/")) roots.push(`src/${spec}`);
    for (const r of roots) for (const ext of TS_EXT) if (modules.has(r + ext)) return modules.get(r + ext);
    return undefined;
  };
  const exportOf = (mod: TsModule, name: string, depth = 0): string | undefined => {
    if (depth > 6) return undefined;
    const direct = mod.exports.get(name) ?? (name !== "default" ? mod.locals.get(name) : undefined);
    if (direct && byId.has(direct)) return direct;
    const re = mod.reexports.get(name);
    if (re) {
      const target = resolveModule(re.module, mod.file);
      if (target) return exportOf(target, re.name, depth + 1);
    }
    for (const [k, star] of mod.reexports) {
      if (!k.startsWith("*")) continue;
      const target = resolveModule(star.module, mod.file);
      const found = target && exportOf(target, name, depth + 1);
      if (found) return found;
    }
    if (name === "default") {
      const comps = [...mod.locals.values()].filter((id) => byId.get(id)?.kind === "component");
      if (comps.length === 1) return comps[0];
    }
    return undefined;
  };

  // ------------------------------------------------------------ HTTP endpoints
  const endpoints = [...byId.values()].filter((e) => e.kind === "endpoint" && Array.isArray(e.meta?.http)).flatMap((e) =>
    (e.meta!.http as string[]).map((h) => {
      const [verb, ...rest] = h.split(" ");
      return { id: e.id, verb, segs: pathSegments(rest.join(" ")) };
    }),
  );
  const matchEndpoint = (method: string, url: string): string[] => {
    let u = url.replace(/^\$\{[^}]*\}/, "").replace(/^[a-z]+:\/\/[^/]+/i, "");
    if (!u.startsWith("/")) {
      if (/^[\w-]+(\/|$)/.test(u)) u = `/${u}`;
      else return [];
    }
    const segs = pathSegments(u);
    const verbOk = (v: string) => method === "ANY" || v === "ANY" || v === method;
    const same = (a: string[], b: string[]) => a.length === b.length && a.every((s, i) => s === b[i] || s === "*" || b[i] === "*");
    const exact = endpoints.filter((e) => verbOk(e.verb) && same(e.segs, segs));
    if (exact.length) return [...new Set(exact.map((e) => e.id))];
    // The front end may add a context path (/api, /occ/v2/site) the controller doesn't know about.
    const suffix = endpoints.filter((e) => verbOk(e.verb) && e.segs.length >= 2 && e.segs.length < segs.length && same(e.segs, segs.slice(segs.length - e.segs.length)));
    return [...new Set(suffix.map((e) => e.id))].slice(0, 3);
  };

  // ------------------------------------------------------------ resolve every pending reference
  let unresolvedCalls = 0;
  for (const p of input.pending) {
    switch (p.type) {
      case "java-type": {
        const t = resolveType(p.typeName, p.file, typeById.get(p.from));
        if (!t) break;
        if (p.kind === "injects") for (const impl of implementationsOf(t, p.bean)) link(p.from, impl.id, "injects", p.file, p.line);
        else link(p.from, t.id, p.kind, p.file, p.line);
        break;
      }
      case "java-call": {
        const caller = methodOwner(p.from);
        let t: JavaType | undefined;
        let bean = p.receiverBean;
        if (p.receiver === "super") t = caller ? superOf(caller) : undefined;
        else if (p.receiverType) t = resolveType(p.receiverType, p.file, caller);
        else if (caller && p.receiver) {
          const f = fieldIn(caller, p.receiver);
          if (f) {
            t = resolveType(f.field.type, f.owner.file, f.owner);
            bean = f.field.bean;
          }
        }
        if (!t && !bean) break;
        const impls = p.receiver === "this" || p.receiver === "super" ? (t ? [t] : []) : implementationsOf(t, bean);
        let found = false;
        for (const impl of impls) for (const m of methodsNamed(impl, p.method)) found = link(p.from, m, "calls", p.file, p.line) || found;
        if (!found && t && p.receiver !== "this") unresolvedCalls++;
        break;
      }
      case "java-new": {
        const t = resolveType(p.className, p.file, methodOwner(p.from));
        if (t && t.kind !== "model" && t.kind !== "class") link(p.from, t.id, "calls", p.file, p.line);
        break;
      }
      case "java-view": {
        const value = evaluate(p.expr, methodOwner(p.from));
        if (!value || value.includes("{call}") || /^\{?(REDIRECT|FORWARD)/i.test(value) || /^(redirect|forward):/.test(value)) break;
        const jsp = jspForView(value.replace(/^\{[^}]*\}/, ""));
        if (jsp) link(p.from, jsp.id, "renders", p.file, p.line);
        break;
      }
      case "java-cms-page": {
        const value = evaluate(p.expr, methodOwner(p.from)).toLowerCase();
        const page = cmsByUid.get(`page:${value}`) ?? cmsByUid.get(`label:${value}`);
        if (page) link(p.from, page.id, "uses", p.file, p.line);
        break;
      }
      case "java-process": {
        for (const arg of p.args) {
          const value = evaluate(arg, methodOwner(p.from));
          if (byId.has(`process:${value}`)) link(p.from, `process:${value}`, "runs", p.file, p.line);
        }
        break;
      }
      case "bean-class": {
        const t = types.get(p.className) ?? resolveType(p.className, p.file);
        if (t) link(p.from, t.id, "defines", p.file, p.line);
        break;
      }
      case "bean-ref": {
        const target = resolveBean(p.bean);
        if (target && byId.has(`bean:${target}`)) link(p.from, `bean:${target}`, p.kind, p.file, p.line);
        else {
          const t = target ? classOfBean(target) : undefined;
          if (t) link(p.from, t.id, p.kind, p.file, p.line);
        }
        break;
      }
      case "job-bean": {
        const target = resolveBean(p.bean);
        if (target && target !== p.bean) {
          if (byId.has(`bean:${target}`)) link(p.from, `bean:${target}`, "runs", p.file, p.line);
          const t = classOfBean(target);
          if (t) link(p.from, t.id, "runs", p.file, p.line);
        }
        break;
      }
      case "jsp-include": {
        const target = p.target.startsWith("/") ? p.target : path.posix.join(path.posix.dirname(p.file), p.target);
        const j = jsps.find((x) => x.file === target || x.file === target.replace(/^\//, "") || x.file.endsWith(target.startsWith("/") ? target : `/${target}`));
        if (j) link(p.from, j.id, "includes", p.file, p.line);
        break;
      }
      case "jsp-tag": {
        const want = `${p.tagdir.replace(/^\//, "")}/${p.tag}`;
        const j = jsps.find((x) => x.kind === "jsp-tag" && (x.file.endsWith(`${want}.tag`) || x.file.endsWith(`${want}.tagx`)));
        if (j) link(p.from, j.id, "includes", p.file, p.line);
        break;
      }
      case "cms-ref":
        link(p.from, `${p.targetKind}:${p.uid}`, p.kind, p.file, p.line);
        break;
      case "cms-view": {
        const jsp = jspForView(`pages/${p.view}`) ?? jspForView(p.view);
        if (jsp) link(p.from, jsp.id, "renders", p.file, p.line);
        break;
      }
      case "cms-type": {
        const controller = classOfBean(`${p.typeCode}Controller`) ?? (bySimple.get(`${p.typeCode}Controller`) ?? [])[0];
        if (controller) link(p.from, controller.id, "uses", p.file, p.line);
        const jsp = jsps.find((j) => j.file.toLowerCase().endsWith(`/cms/${p.typeCode.toLowerCase()}.jsp`));
        if (jsp) link(p.from, jsp.id, "renders", p.file, p.line);
        break;
      }
      case "item-ref":
        link(p.from, `item:${p.typeCode}`, p.kind, p.file, p.line);
        break;
      case "ext-ref":
        link(p.from, `ext:${p.extension}`, "requires", p.file, p.line);
        break;
      case "ts-ref": {
        if (!p.module) break;
        const mod = resolveModule(p.module, p.file);
        const target = mod && exportOf(mod, p.name);
        if (target) link(p.from, target, p.kind, p.file, p.line);
        break;
      }
      case "http-call":
        for (const id of matchEndpoint(p.method, p.url)) link(p.from, id, "http", p.file, p.line);
        break;
      case "bean-alias":
        break;
    }
  }

  // A single-page app's root only counts as an entry point when there are no routes.
  const routes = [...byId.values()].filter((e) => e.kind === "route");
  const roots = routes.filter((r) => r.meta?.appRoot === "true");
  if (roots.length && routes.length > roots.length) for (const r of roots) byId.delete(r.id);

  const kept = links.filter((l) => byId.has(l.from) && byId.has(l.to));
  return { elements: [...byId.values()], links: kept, unresolvedCalls };
}
