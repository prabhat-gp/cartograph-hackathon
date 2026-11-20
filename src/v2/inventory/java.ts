// Java parser: types, layers, fields, methods, Spring and JAX-RS mappings,
// calls and returned view names. Works on masked code (see lex.ts) with
// bracket matching, so it needs no Java toolchain and never runs the code.
import { type Masked, maskJava, matchBracket } from "./lex";
import type { ElementKind, InventoryElement, InventoryLink, ParsedFile, PendingRef, SourceFile } from "./types";

export interface JavaAnnotation {
  name: string;
  /** Raw source between the parentheses ("" when there are none). */
  args: string;
}

export interface JavaField {
  type: string;
  bean?: string;
}

export interface JavaMethod {
  id: string;
  name: string;
  line: number;
  params: { name: string; type: string }[];
  annotations: JavaAnnotation[];
}

export interface JavaType {
  fqn: string;
  name: string;
  id: string;
  file: string;
  pkg: string;
  outer?: string;
  declKind: "class" | "interface" | "enum" | "record";
  kind: ElementKind;
  annotations: JavaAnnotation[];
  extends: string[];
  implements: string[];
  fields: Map<string, JavaField>;
  methods: JavaMethod[];
  /** String constants: name → raw expression. */
  constants: Map<string, string>;
  line: number;
}

export interface JavaUnit {
  file: string;
  pkg: string;
  /** Simple name → fully qualified name. */
  imports: Map<string, string>;
  wildcards: string[];
  types: JavaType[];
}

const MODIFIER = /^(public|private|protected|static|final|abstract|default|synchronized|native|transient|volatile|strictfp|sealed|non-sealed)$/;
const KEYWORDS = new Set(["if", "for", "while", "switch", "catch", "synchronized", "return", "new", "throw", "else", "do", "try", "super", "this", "assert", "case"]);
const MAPPINGS: Record<string, string> = { RequestMapping: "", GetMapping: "GET", PostMapping: "POST", PutMapping: "PUT", DeleteMapping: "DELETE", PatchMapping: "PATCH" };
const JAXRS = new Set(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]);

interface Span {
  name: string;
  start: number;
  end: number;
  args: string;
}

function annotationSpans(m: Masked, source: string): Span[] {
  const spans: Span[] = [];
  const re = /@([A-Za-z_$][\w$.]*)/g;
  let hit: RegExpExecArray | null;
  while ((hit = re.exec(m.code))) {
    if (hit[1] === "interface") continue;
    let end = hit.index + hit[0].length;
    let args = "";
    let k = end;
    while (k < m.code.length && /\s/.test(m.code[k])) k++;
    if (m.code[k] === "(") {
      const close = matchBracket(m.code, k);
      if (close > 0) {
        args = source.slice(k + 1, close);
        end = close + 1;
      }
    }
    spans.push({ name: hit[1].split(".").pop()!, start: hit.index, end, args });
    re.lastIndex = end;
  }
  return spans;
}

function stripGenerics(s: string): string {
  let prev = "";
  while (prev !== s) {
    prev = s;
    s = s.replace(/<[^<>]*>/g, "");
  }
  return s;
}

function splitTop(s: string, sep = ","): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if ("<([{".includes(ch)) depth++;
    else if (">)]}".includes(ch)) depth--;
    if (ch === sep && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** The identifier that ends right before `end` (scanning backwards, no slicing). */
function identBefore(code: string, end: number): string | undefined {
  let i = end;
  while (i > 0 && /[\w$-]/.test(code[i - 1])) i--;
  return i < end ? code.slice(i, end) : undefined;
}

const has = (anns: JavaAnnotation[], ...names: string[]) => anns.some((a) => names.includes(a.name));

function classify(t: Omit<JavaType, "kind">): ElementKind {
  const n = t.name;
  const supers = [...t.extends, ...t.implements].map((s) => s.split(".").pop()!);
  const sup = (re: RegExp) => supers.some((s) => re.test(s));
  if (has(t.annotations, "Controller", "RestController") || /Controller$/.test(n) && t.declKind === "class" && sup(/Controller$/)) {
    return sup(/CMS.*ComponentController|ComponentController$/) || /ComponentController$/.test(n) ? "cms-controller" : "controller";
  }
  if (t.declKind === "enum" || t.declKind === "record") return "model";
  if (has(t.annotations, "Configuration", "SpringBootApplication", "EnableWebMvc")) return "config";
  if (sup(/^(AbstractEventListener|AbstractSiteEventListener|AbstractAcceleratorSiteEventListener|ApplicationListener)$/) || /EventListener$/.test(n)) return "event-listener";
  if (sup(/^(AbstractJobPerformable|JobPerformable|AbstractAbortableJobPerformable)$/) || /JobPerformable$/.test(n)) return "job";
  if (sup(/^(AbstractProceduralAction|AbstractSimpleDecisionAction|AbstractAction|AbstractSimpleAction|AbstractAcceleratorProceduralAction)$/) || /Action$/.test(n) && sup(/Action$/)) return "process-action";
  if (/Facade(Impl)?$/.test(n) || sup(/Facade$/)) return "facade";
  if (has(t.annotations, "Repository") || /(Dao|DAO|Repository)(Impl)?$/.test(n) || sup(/^(JpaRepository|CrudRepository|PagingAndSortingRepository|MongoRepository|GenericDao|Dao)$/)) return "dao";
  if (/Populator$/.test(n) || sup(/^Populator$/)) return "populator";
  if (/Converter$/.test(n) || sup(/^Converter$/)) return "converter";
  if (/Interceptor$/.test(n) || sup(/Interceptor$/)) return "interceptor";
  if (has(t.annotations, "Service") || /Service(Impl)?$/.test(n) || sup(/Service$/)) return "service";
  if (has(t.annotations, "Entity", "Document", "Table", "Embeddable") || /(Data|Model|DTO|Dto|WsDTO|Form|Entity)$/.test(n)) return "model";
  return t.declKind === "interface" ? "interface" : "class";
}

function beanOf(anns: JavaAnnotation[]): string | undefined {
  for (const a of anns) {
    if (a.name === "Resource") {
      const m = a.args.match(/name\s*=\s*"([^"]+)"/);
      if (m) return m[1];
    }
    if (a.name === "Qualifier" || a.name === "Named") {
      const m = a.args.match(/"([^"]+)"/);
      if (m) return m[1];
    }
  }
  return undefined;
}

/** Mapping annotations → { http methods, raw path expressions }. */
export function mappingOf(anns: JavaAnnotation[]): { methods: string[]; paths: string[] } | undefined {
  for (const a of anns) {
    if (a.name in MAPPINGS) {
      const fixed = MAPPINGS[a.name];
      const parts = splitTop(a.args);
      let pathExpr = "";
      const methods: string[] = fixed ? [fixed] : [];
      for (const part of parts) {
        const kv = part.match(/^(\w+)\s*=\s*([\s\S]+)$/);
        if (!kv) pathExpr = part;
        else if (kv[1] === "value" || kv[1] === "path") pathExpr = kv[2];
        else if (kv[1] === "method") methods.push(...[...kv[2].matchAll(/RequestMethod\.(\w+)|\b(GET|POST|PUT|DELETE|PATCH)\b/g)].map((x) => x[1] ?? x[2]));
      }
      const arr = pathExpr.trim().replace(/^\{([\s\S]*)\}$/, "$1");
      return { methods: [...new Set(methods)], paths: arr ? splitTop(arr) : [] };
    }
  }
  const verb = anns.find((a) => JAXRS.has(a.name));
  const p = anns.find((a) => a.name === "Path");
  if (verb || p) return { methods: verb ? [verb.name] : [], paths: p ? [p.args.trim()] : [] };
  return undefined;
}

export function parseJava(file: SourceFile): ParsedFile & { unit: JavaUnit } {
  const source = file.content;
  const m = maskJava(source);
  const code = m.code;
  const elements: InventoryElement[] = [];
  const links: InventoryLink[] = [];
  const pending: PendingRef[] = [];
  const pkg = code.match(/^\s*package\s+([\w.]+)\s*;/m)?.[1] ?? "";
  const imports = new Map<string, string>();
  const wildcards: string[] = [];
  for (const im of code.matchAll(/^\s*import\s+(static\s+)?([\w.]+)(\.\*)?\s*;/gm)) {
    if (im[3]) wildcards.push(im[2]);
    else if (!im[1]) imports.set(im[2].split(".").pop()!, im[2]);
  }
  const unit: JavaUnit = { file: file.path, pkg, imports, wildcards, types: [] };
  const spans = annotationSpans(m, source);
  const spanByEnd = new Map(spans.map((s) => [s.end, s]));
  const spansIn = (from: number, to: number): Span[] => {
    let lo = 0;
    let hi = spans.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (spans[mid].start < from) lo = mid + 1;
      else hi = mid;
    }
    const out: Span[] = [];
    for (let i = lo; i < spans.length && spans[i].start < to; i++) if (spans[i].end <= to) out.push(spans[i]);
    return out;
  };

  const annotationsBefore = (pos: number): JavaAnnotation[] => {
    const found: JavaAnnotation[] = [];
    let p = pos;
    for (;;) {
      while (p > 0 && /\s/.test(code[p - 1])) p--;
      const span = spanByEnd.get(p);
      if (span) {
        found.unshift({ name: span.name, args: span.args });
        p = span.start;
        continue;
      }
      const word = identBefore(code, p);
      if (word && MODIFIER.test(word)) {
        p -= word.length;
        continue;
      }
      break;
    }
    return found;
  };
  const blankAnnotations = (from: number, to: number): string => {
    let text = code.slice(from, to);
    for (const s of spansIn(from, to)) text = text.slice(0, s.start - from) + " ".repeat(s.end - s.start) + text.slice(s.end - from);
    return text;
  };

  // ------------------------------------------------------------ type declarations
  interface Decl { name: string; declKind: JavaType["declKind"]; kw: number; open: number; close: number; header: string }
  const decls: Decl[] = [];
  for (const d of code.matchAll(/(?<![\w$.@])(class|interface|enum|record)\s+([A-Za-z_$][\w$]*)/g)) {
    let b = d.index;
    while (b > 0 && /\s/.test(code[b - 1])) b--;
    if (code[b - 1] === "@") continue; // @interface
    let k = d.index + d[0].length;
    let depth = 0;
    while (k < code.length) {
      const ch = code[k];
      if (ch === "(" || ch === "<") depth++;
      else if (ch === ")" || ch === ">") depth--;
      else if ((ch === "{" && depth <= 0) || ch === ";") break;
      k++;
    }
    if (code[k] !== "{") continue;
    const close = matchBracket(code, k);
    if (close < 0) continue;
    decls.push({ name: d[2], declKind: d[1] as Decl["declKind"], kw: d.index, open: k, close, header: stripGenerics(code.slice(d.index + d[0].length, k)) });
  }
  decls.sort((a, b) => a.kw - b.kw);
  const typeOf = new Map<Decl, JavaType>();

  for (const d of decls) {
    const outerDecl = [...decls].reverse().find((o) => o !== d && o.open < d.kw && o.close > d.close);
    const outer = outerDecl ? typeOf.get(outerDecl) : undefined;
    const fqn = outer ? `${outer.fqn}.${d.name}` : pkg ? `${pkg}.${d.name}` : d.name;
    const ext = d.header.match(/\bextends\s+([\w$.,\s]+?)(?=\bimplements\b|\bpermits\b|$)/)?.[1] ?? "";
    const impl = d.header.match(/\bimplements\s+([\w$.,\s]+?)(?=\bpermits\b|$)/)?.[1] ?? "";
    const base = {
      fqn, name: d.name, id: `java:${fqn}`, file: file.path, pkg, outer: outer?.fqn, declKind: d.declKind,
      annotations: annotationsBefore(d.kw),
      extends: splitTop(ext).map((s) => s.trim()),
      implements: splitTop(impl).map((s) => s.trim()),
      fields: new Map<string, JavaField>(), methods: [] as JavaMethod[], constants: new Map<string, string>(),
      line: m.lineAt(d.kw),
    };
    const type: JavaType = { ...base, kind: classify(base) };
    typeOf.set(d, type);
    unit.types.push(type);
  }

  for (const d of decls) {
    const type = typeOf.get(d)!;
    const nested = decls.filter((o) => o !== d && o.kw > d.open && o.close < d.close);
    const classMapping = mappingOf(type.annotations);
    const meta: Record<string, string | string[]> = { package: pkg };
    if (type.annotations.length) meta.annotations = type.annotations.map((a) => a.name);
    if (type.extends.length) meta.extends = type.extends;
    if (type.implements.length) meta.implements = type.implements;
    if (classMapping?.paths.length) meta.mapping = classMapping.paths;
    const named = type.annotations.find((a) => ["Controller", "Component", "Service", "Repository", "RestController"].includes(a.name))?.args.match(/"([^"]+)"/)?.[1];
    if (named) meta.bean = named;
    elements.push({ id: type.id, kind: type.kind, name: type.outer ? `${type.outer.split(".").pop()}.${type.name}` : type.name, file: file.path, line: type.line, endLine: m.lineAt(d.close), ...(type.outer ? { parent: `java:${type.outer}` } : {}), meta });
    if (type.outer) links.push({ from: `java:${type.outer}`, to: type.id, kind: "contains", file: file.path, line: type.line });
    for (const s of type.extends) pending.push({ type: "java-type", from: type.id, typeName: s, kind: type.declKind === "interface" ? "implements" : "extends", file: file.path, line: type.line });
    for (const s of type.implements) pending.push({ type: "java-type", from: type.id, typeName: s, kind: "implements", file: file.path, line: type.line });

    // ---------------------------------------------------------- members
    const methodBodies: { method: JavaMethod; open: number; close: number; params: Map<string, string> }[] = [];
    let seg = d.open + 1;
    let i = d.open + 1;
    let fieldInit = false;
    const seen = new Map<string, number>();
    const handleSegment = (from: number, to: number, bodyOpen?: number) => {
      const raw = blankAnnotations(from, to);
      const header = stripGenerics(raw).replace(/\s+/g, " ").trim();
      if (!header || /^(static|default)$/.test(header)) return;
      const anns = spansIn(from, to).map((s) => ({ name: s.name, args: s.args }));
      const eq = header.indexOf("=");
      const paren = header.indexOf("(");
      if (paren > 0 && (eq < 0 || paren < eq)) {
        const mm = header.match(/([A-Za-z_$][\w$]*)\s*\(([^()]*)\)\s*(?:throws\s+[\w$.,\s]+)?$/);
        if (!mm || KEYWORDS.has(mm[1])) return;
        const name = mm[1];
        const params = splitTop(mm[2]).map((p) => {
          const words = p.replace(/\bfinal\b/g, "").replace(/\.\.\./g, "[]").trim().split(/\s+/);
          return { name: words.at(-1) ?? "", type: (words.at(-2) ?? "").replace(/\[\]$/, "") };
        }).filter((p) => p.name && p.type);
        const count = (seen.get(name) ?? 0) + 1;
        seen.set(name, count);
        const id = `${type.id}#${name}${count > 1 ? `~${count}` : ""}`;
        const line = m.lineAt(from + raw.search(/\S/));
        const method: JavaMethod = { id, name, line, params, annotations: anns };
        type.methods.push(method);
        const mapping = mappingOf(anns);
        let kind: ElementKind = "method";
        const mmeta: Record<string, string | string[]> = {};
        if (mapping && (type.kind === "controller" || type.kind === "cms-controller" || mapping.paths.length || has(type.annotations, "Path"))) {
          kind = "endpoint";
          mmeta.mapping = mapping.paths.length ? mapping.paths : ['""'];
          if (classMapping?.paths.length) mmeta.classMapping = classMapping.paths;
          mmeta.methods = mapping.methods.length ? mapping.methods : classMapping?.methods.length ? classMapping.methods : ["ANY"];
        } else if (has(anns, "Scheduled")) {
          kind = "cronjob";
          const cron = anns.find((a) => a.name === "Scheduled")?.args.trim();
          if (cron) mmeta.schedule = cron;
        } else if (has(anns, "EventListener", "KafkaListener", "JmsListener", "RabbitListener", "SqsListener", "StreamListener", "TransactionalEventListener")) {
          kind = "event-listener";
          const ann = anns.find((a) => /Listener$/.test(a.name));
          if (ann?.args) mmeta.listens = ann.args.trim().slice(0, 200);
        }
        if (anns.length) mmeta.annotations = anns.map((a) => a.name);
        if (name === type.name) mmeta.ctor = "true";
        elements.push({ id, kind, name: `${type.name}.${name}`, file: file.path, line, endLine: bodyOpen !== undefined ? m.lineAt(matchBracket(code, bodyOpen)) : line, parent: type.id, ...(Object.keys(mmeta).length ? { meta: mmeta } : {}) });
        links.push({ from: type.id, to: id, kind: "contains", file: file.path, line });
        if (bodyOpen !== undefined) {
          const close = matchBracket(code, bodyOpen);
          if (close > 0) methodBodies.push({ method, open: bodyOpen, close, params: new Map(params.map((p) => [p.name, p.type])) });
          // Constructor parameters are injected dependencies.
          if (name === type.name) for (const p of params) if (/^[A-Z]/.test(p.type)) {
            pending.push({ type: "java-type", from: type.id, typeName: p.type, kind: "injects", file: file.path, line });
            if (!type.fields.has(p.name)) type.fields.set(p.name, { type: p.type });
          }
        }
        return;
      }
      // Field: [modifiers] Type name [= expr]
      const decl = (eq >= 0 ? header.slice(0, eq) : header).trim().split(" ").filter((w) => !MODIFIER.test(w));
      if (decl.length < 2) return;
      const fname = decl.at(-1)!;
      const ftype = decl.at(-2)!.replace(/\[\]$/, "");
      if (!/^[A-Za-z_$][\w$]*$/.test(fname) || !/^[A-Za-z_$][\w$.]*$/.test(ftype)) return;
      const bean = beanOf(anns);
      type.fields.set(fname, { type: ftype, ...(bean ? { bean } : {}) });
      const isStatic = /\bstatic\b/.test(raw) || type.declKind === "interface";
      if (eq >= 0 && isStatic && ftype === "String") {
        const rawEq = source.slice(from, to).indexOf("=");
        if (rawEq >= 0) type.constants.set(fname, source.slice(from + rawEq + 1, to).trim());
      }
      if (!isStatic && /^[A-Z]/.test(ftype) && !/^(String|Integer|Long|Boolean|Double|Map|List|Set|Collection|Optional|Logger|Object)$/.test(ftype)) {
        pending.push({ type: "java-type", from: type.id, typeName: ftype, kind: "injects", ...(bean ? { bean } : {}), file: file.path, line: m.lineAt(from + raw.search(/\S/)) });
      }
    };
    while (i < d.close) {
      const ch = code[i];
      if (ch === "{") {
        const close = matchBracket(code, i);
        if (close < 0) break;
        if (nested.some((o) => o.open === i)) {
          i = close + 1;
          seg = i;
          continue;
        }
        if (/=/.test(blankAnnotations(seg, i)) || fieldInit) {
          fieldInit = true; // initializer block of a field: keep scanning to its ';'
          i = close + 1;
          continue;
        }
        if (/\)\s*(throws\s+[\w$.,\s]+)?$/.test(stripGenerics(blankAnnotations(seg, i)).trim())) handleSegment(seg, i, i);
        i = close + 1;
        seg = i;
        continue;
      }
      if (ch === ";") {
        handleSegment(seg, i);
        fieldInit = false;
        seg = i + 1;
      }
      i++;
    }

    // ---------------------------------------------------------- method bodies
    for (const { method, open, close, params } of methodBodies) {
      const body = code.slice(open, close + 1);
      const locals = new Map<string, string>();
      for (const v of body.matchAll(/(?<![\w$.])([A-Z][\w$]*(?:\.[A-Z][\w$]*)*)(?:<[^;(){}]*?>)?(?:\[\])?\s+([a-z_$][\w$]*)\s*(?=[=;:,)])/g)) locals.set(v[2], v[1]);
      for (const v of body.matchAll(/\bvar\s+([\w$]+)\s*=\s*new\s+([A-Z][\w$.]*)/g)) locals.set(v[1], v[2]);
      const typeFor = (name: string) => locals.get(name) ?? params.get(name);
      for (const c of body.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)) {
        const name = c[1];
        if (KEYWORDS.has(name)) continue;
        const at = open + c.index;
        const line = m.lineAt(at);
        let k = at - 1;
        while (k >= 0 && /\s/.test(code[k])) k--;
        const prevWord = code.slice(Math.max(0, k - 3), k + 1);
        if (prevWord === "new" && /[^\w$]/.test(code[k - 3] ?? " ")) {
          pending.push({ type: "java-new", from: method.id, className: name, file: file.path, line });
          continue;
        }
        if (code[k] !== ".") {
          if (/^[A-Z]/.test(name)) continue; // a type name, e.g. in a cast
          pending.push({ type: "java-call", from: method.id, receiver: "this", receiverType: type.fqn, method: name, file: file.path, line });
          continue;
        }
        k--;
        while (k >= 0 && /\s/.test(code[k])) k--;
        let receiver: string | undefined;
        let viaGetter = false;
        if (code[k] === ")") {
          let depth = 0;
          let j = k;
          for (; j >= 0; j--) {
            if (code[j] === ")") depth++;
            else if (code[j] === "(" && --depth === 0) break;
          }
          let g0 = j;
          while (g0 > 0 && /\s/.test(code[g0 - 1])) g0--;
          const getter = identBefore(code, g0)?.replace(/^-+/, "");
          const g = getter?.match(/^get([A-Z][\w$]*)$/);
          if (g && code.slice(j + 1, k).trim() === "") {
            receiver = g[1][0].toLowerCase() + g[1].slice(1);
            viaGetter = true;
          }
        } else {
          receiver = identBefore(code, k + 1)?.replace(/^[-\d]+/, "") || undefined;
        }
        if (!receiver || receiver === "super") {
          if (receiver === "super") pending.push({ type: "java-call", from: method.id, receiver: "super", receiverType: type.fqn, method: name, file: file.path, line });
          continue;
        }
        if (receiver === "this") {
          pending.push({ type: "java-call", from: method.id, receiver: "this", receiverType: type.fqn, method: name, file: file.path, line });
          continue;
        }
        const local = viaGetter ? undefined : typeFor(receiver);
        const field = type.fields.get(receiver);
        if (local) pending.push({ type: "java-call", from: method.id, receiver, receiverType: local, method: name, file: file.path, line });
        else if (field) pending.push({ type: "java-call", from: method.id, receiver, receiverType: field.type, ...(field.bean ? { receiverBean: field.bean } : {}), method: name, file: file.path, line });
        else if (/^[A-Z]/.test(receiver) && !viaGetter) pending.push({ type: "java-call", from: method.id, receiver, receiverType: receiver, method: name, file: file.path, line });
        else pending.push({ type: "java-call", from: method.id, receiver, method: name, file: file.path, line });
      }
      for (const g of body.matchAll(/\b(createProcess|startProcess)\s*\(/g)) {
        const at = open + g.index + g[0].length - 1;
        const closeArg = matchBracket(code, at);
        if (closeArg > 0) pending.push({ type: "java-process", from: method.id, args: splitTop(source.slice(at + 1, closeArg)), file: file.path, line: m.lineAt(at) });
      }
      if (type.kind === "controller" || type.kind === "cms-controller") {
        for (const r of body.matchAll(/\breturn\s+([^;]+);/g)) {
          const at = open + r.index;
          const expr = source.slice(at + r[0].indexOf(r[1]), at + r[0].indexOf(r[1]) + r[1].length).trim();
          if (/^(null|true|false|\d)/.test(expr) || /^new\s/.test(expr)) continue;
          pending.push({ type: "java-view", from: method.id, expr, file: file.path, line: m.lineAt(at) });
        }
        for (const g of body.matchAll(/\b(getContentPageForLabelOrId|getContentPageForLabel|getPageForLabelOrId|getPageForId|getPageForIdWithRestrictions|getCategoryPage|getProductPage)\s*\(/g)) {
          const at = open + g.index + g[0].length - 1;
          const closeArg = matchBracket(code, at);
          if (closeArg < 0) continue;
          const arg = splitTop(source.slice(at + 1, closeArg))[0];
          if (arg) pending.push({ type: "java-cms-page", from: method.id, expr: arg, file: file.path, line: m.lineAt(at) });
        }
      }
    }
  }
  return { elements, links, pending, unit };
}
