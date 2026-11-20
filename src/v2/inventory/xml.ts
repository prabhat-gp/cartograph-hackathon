// XML: Spring bean files, SAP Commerce items.xml, extensioninfo.xml and
// business process definitions. Other XML (pom.xml, logging) is read and left.
import type { InventoryElement, InventoryLink, ParsedFile, PendingRef, SourceFile } from "./types";

interface Tag {
  name: string;
  attrs: Record<string, string>;
  close: boolean;
  selfClose: boolean;
  line: number;
}

function lineIndex(text: string) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return (offset: number) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

export function xmlTags(source: string): Tag[] {
  const text = source.replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, " ")).replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, (c) => c.replace(/[^\n]/g, " "));
  const lineAt = lineIndex(text);
  const tags: Tag[] = [];
  for (const t of text.matchAll(/<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g)) {
    const attrs: Record<string, string> = {};
    for (const a of t[3].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = (a[2] ?? a[3] ?? "").trim();
    tags.push({ name: t[2], attrs, close: t[1] === "/", selfClose: t[4] === "/", line: lineAt(t.index) });
  }
  return tags;
}

export type XmlKind = "spring" | "items" | "extension" | "process" | "other";

export function xmlKind(path: string, tags: Tag[]): XmlKind {
  const root = tags.find((t) => !t.close && !t.name.startsWith("?"))?.name.replace(/^\w+:/, "");
  if (/(^|\/)extensioninfo\.xml$/i.test(path)) return "extension";
  if (root === "items" || /-items\.xml$/i.test(path)) return "items";
  if (root === "process") return "process";
  if (root === "beans") return "spring";
  return "other";
}

export function parseXml(file: SourceFile): ParsedFile & { xmlKind: XmlKind } {
  const tags = xmlTags(file.content);
  const kind = xmlKind(file.path, tags);
  const elements: InventoryElement[] = [];
  const links: InventoryLink[] = [];
  const pending: PendingRef[] = [];
  const at = (line: number) => ({ file: file.path, line });

  if (kind === "spring") {
    // Stack of open elements; the nearest named bean owns refs below it.
    const stack: { tag: Tag; beanId?: string; property?: string; modify?: { list?: string; add: string[]; line: number } }[] = [];
    const owner = () => [...stack].reverse().find((s) => s.beanId)?.beanId;
    const property = () => [...stack].reverse().find((s) => s.property)?.property;
    const modifier = () => [...stack].reverse().find((s) => s.modify)?.modify;
    const refKind = (prop?: string) => (prop && /populators|^add$|^list$/.test(prop) ? "populates" : "injects");
    for (const tag of tags) {
      const local = tag.name.replace(/^\w+:/, "");
      if (tag.close) {
        const top = stack.pop();
        if (top?.modify?.list) for (const add of top.modify.add) pending.push({ type: "bean-ref", from: `bean:${top.modify.list}`, bean: add, kind: "populates", ...at(top.modify.line) });
        continue;
      }
      const entry: (typeof stack)[number] = { tag };
      if (local === "bean" || (["list", "map", "set"].includes(local) && tag.name.startsWith("util:") && tag.attrs.id)) {
        const id = tag.attrs.id ?? tag.attrs.name?.split(/[,\s]+/)[0];
        if (tag.attrs.parent === "modifyPopulatorList" || tag.attrs.parent === "modifyPopulatorListInheritance") entry.modify = { add: [], line: tag.line };
        if (id) {
          entry.beanId = id;
          const meta: Record<string, string> = {};
          if (tag.attrs.class) meta.class = tag.attrs.class;
          if (tag.attrs.parent) meta.parent = tag.attrs.parent;
          if (tag.attrs.abstract === "true") meta.abstract = "true";
          if (tag.attrs.scope) meta.scope = tag.attrs.scope;
          elements.push({ id: `bean:${id}`, kind: "bean", name: id, file: file.path, line: tag.line, meta });
          if (tag.attrs.class) pending.push({ type: "bean-class", from: `bean:${id}`, className: tag.attrs.class, ...at(tag.line) });
          if (tag.attrs.parent) pending.push({ type: "bean-ref", from: `bean:${id}`, bean: tag.attrs.parent, kind: "extends", ...at(tag.line) });
          for (const extra of tag.attrs.name?.split(/[,\s]+/).slice(tag.attrs.id ? 0 : 1) ?? []) if (extra) pending.push({ type: "bean-alias", alias: extra, bean: id, ...at(tag.line) });
        } else if (tag.attrs.class && owner()) {
          pending.push({ type: "bean-class", from: `bean:${owner()}`, className: tag.attrs.class, ...at(tag.line) });
        }
      } else if (local === "alias" && tag.attrs.name && tag.attrs.alias) {
        pending.push({ type: "bean-alias", alias: tag.attrs.alias, bean: tag.attrs.name, ...at(tag.line) });
      } else if (local === "property" || local === "constructor-arg") {
        entry.property = tag.attrs.name ?? "arg";
        const mod = modifier();
        if (mod && tag.attrs.name === "list" && tag.attrs.ref) mod.list = tag.attrs.ref;
        else if (mod && tag.attrs.name === "add" && tag.attrs.ref) mod.add.push(tag.attrs.ref);
        else if (tag.attrs.ref && owner()) pending.push({ type: "bean-ref", from: `bean:${owner()}`, bean: tag.attrs.ref, kind: refKind(tag.attrs.name), property: tag.attrs.name, ...at(tag.line) });
      } else if (local === "ref" && tag.attrs.bean) {
        const mod = modifier();
        const prop = property();
        if (mod && prop === "add") mod.add.push(tag.attrs.bean);
        else if (owner()) pending.push({ type: "bean-ref", from: `bean:${owner()}`, bean: tag.attrs.bean, kind: refKind(prop), property: prop, ...at(tag.line) });
      } else if (local === "entry") {
        for (const k of ["key-ref", "value-ref"]) if (tag.attrs[k] && owner()) pending.push({ type: "bean-ref", from: `bean:${owner()}`, bean: tag.attrs[k], kind: "injects", ...at(tag.line) });
      }
      if (!tag.selfClose) stack.push(entry);
      else if (entry.modify?.list) for (const add of entry.modify.add) pending.push({ type: "bean-ref", from: `bean:${entry.modify.list}`, bean: add, kind: "populates", ...at(tag.line) });
    }
  } else if (kind === "items") {
    let current: { id: string; attrs: string[]; el: InventoryElement } | undefined;
    let relation: { code: string; source?: string; target?: string; line: number } | undefined;
    for (const tag of tags) {
      if (tag.close) {
        if (tag.name === "itemtype" && current) {
          if (current.attrs.length) current.el.meta = { ...current.el.meta, attributes: current.attrs.slice(0, 80) };
          current = undefined;
        }
        if (tag.name === "relation" && relation) {
          if (relation.source && relation.target) pending.push({ type: "item-ref", from: `item:${relation.source}`, typeCode: relation.target, kind: "uses", ...at(relation.line) });
          relation = undefined;
        }
        continue;
      }
      if (tag.name === "itemtype" || tag.name === "enumtype") {
        const code = tag.attrs.code;
        if (!code) continue;
        const el: InventoryElement = { id: `item:${code}`, kind: "item-type", name: code, file: file.path, line: tag.line, meta: { ...(tag.name === "enumtype" ? { enum: "true" } : {}), ...(tag.attrs.extends ? { extends: tag.attrs.extends } : {}) } };
        elements.push(el);
        if (tag.attrs.extends) pending.push({ type: "item-ref", from: el.id, typeCode: tag.attrs.extends, kind: "extends", ...at(tag.line) });
        if (tag.name === "itemtype" && !tag.selfClose) current = { id: el.id, attrs: [], el };
      } else if (tag.name === "attribute" && current && tag.attrs.qualifier) {
        current.attrs.push(`${tag.attrs.qualifier}: ${tag.attrs.type ?? "?"}`);
        if (tag.attrs.type && /^[A-Z]/.test(tag.attrs.type) && !/^java\./.test(tag.attrs.type)) pending.push({ type: "item-ref", from: current.id, typeCode: tag.attrs.type.replace(/^localized:/, ""), kind: "uses", ...at(tag.line) });
      } else if (tag.name === "relation" && tag.attrs.code) {
        relation = { code: tag.attrs.code, line: tag.line };
      } else if (relation && tag.name === "sourceElement") relation.source = tag.attrs.type;
      else if (relation && tag.name === "targetElement") relation.target = tag.attrs.type;
    }
  } else if (kind === "extension") {
    const ext = tags.find((t) => t.name === "extension" && !t.close && t.attrs.name);
    if (ext) {
      const dir = file.path.split("/").slice(0, -1).join("/");
      const web = tags.find((t) => t.name === "webmodule")?.attrs.webroot;
      elements.push({ id: `ext:${ext.attrs.name}`, kind: "extension", name: ext.attrs.name, file: file.path, line: ext.line, meta: { dir, ...(web ? { webroot: web } : {}) } });
      for (const r of tags.filter((t) => t.name === "requires-extension" && t.attrs.name)) pending.push({ type: "ext-ref", from: `ext:${ext.attrs.name}`, extension: r.attrs.name, ...at(r.line) });
    }
  } else if (kind === "process") {
    const root = tags.find((t) => t.name === "process" && !t.close);
    if (root?.attrs.name) {
      const id = `process:${root.attrs.name}`;
      const actions = tags.filter((t) => t.name === "action" && !t.close && t.attrs.id);
      elements.push({ id, kind: "business-process", name: root.attrs.name, file: file.path, line: root.line, meta: { ...(root.attrs.start ? { start: root.attrs.start } : {}), steps: actions.map((a) => a.attrs.id) } });
      for (const a of actions) if (a.attrs.bean) pending.push({ type: "bean-ref", from: id, bean: a.attrs.bean, kind: "runs", ...at(a.line) });
    }
  }
  return { elements, links, pending, xmlKind: kind };
}
