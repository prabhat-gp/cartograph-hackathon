// ImpEx: the CMS data that composes Accelerator pages (pages, templates, slots,
// components) and the cronjobs that run on a schedule. Page layout lives here,
// not in Java, so without it a storefront's pages can't be fully mapped.
import type { InventoryElement, ParsedFile, PendingRef, SourceFile } from "./types";

function splitRow(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === ";" && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

const refValue = (v: string) => v.split(":")[0].trim();

export function parseImpex(file: SourceFile): ParsedFile {
  const elements = new Map<string, InventoryElement>();
  const pending: PendingRef[] = [];
  const lines = file.content.split("\n");
  let header: { type: string; mode: string; cols: string[] } | undefined;
  const add = (el: InventoryElement) => {
    const prev = elements.get(el.id);
    if (prev) prev.meta = { ...el.meta, ...prev.meta };
    else elements.set(el.id, el);
  };
  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n].replace(/\r$/, "");
    const line = raw.trim();
    const lineNo = n + 1;
    if (!line || line.startsWith("#") || line.startsWith("$") || line.startsWith('"#%')) continue;
    const h = line.match(/^(INSERT_UPDATE|INSERT|UPDATE|REMOVE)\s+([\w]+)\s*;(.*)$/i);
    if (h) {
      header = { mode: h[1].toUpperCase(), type: h[2], cols: splitRow(h[3]).map((c) => c.replace(/\[.*$/, "").replace(/\(.*$/, "").trim()) };
      continue;
    }
    if (!header || !line.startsWith(";") || header.mode === "REMOVE") continue;
    const vals = splitRow(line).slice(1);
    const col = (name: string) => {
      const i = header!.cols.indexOf(name);
      return i >= 0 ? vals[i] ?? "" : "";
    };
    const t = header.type;
    const at = { file: file.path, line: lineNo };
    if (/Page$/.test(t) && !/Template$/.test(t) && !/^ContentSlotFor/.test(t)) {
      const uid = col("uid");
      if (!uid) continue;
      const id = `cms-page:${uid}`;
      const label = col("label");
      const template = refValue(col("masterTemplate"));
      add({ id, kind: "cms-page", name: col("name") || uid, file: file.path, line: lineNo, meta: { uid, type: t, ...(label ? { label } : {}), ...(template ? { template } : {}) } });
      if (template) pending.push({ type: "cms-ref", from: id, uid: template, targetKind: "cms-template", kind: "uses", ...at });
    } else if (/PageTemplate$/.test(t)) {
      const uid = col("uid");
      if (!uid) continue;
      const id = `cms-template:${uid}`;
      const view = col("frontendTemplateName");
      add({ id, kind: "cms-template", name: col("name") || uid, file: file.path, line: lineNo, meta: { uid, ...(view ? { view } : {}) } });
      if (view) pending.push({ type: "cms-view", from: id, view, ...at });
    } else if (t === "ContentSlot") {
      const uid = col("uid");
      if (!uid) continue;
      const id = `cms-slot:${uid}`;
      add({ id, kind: "cms-slot", name: col("name") || uid, file: file.path, line: lineNo, meta: { uid } });
      for (const c of col("cmsComponents").split(",").map(refValue).filter(Boolean)) pending.push({ type: "cms-ref", from: id, uid: c, targetKind: "cms-component", kind: "places", ...at });
    } else if (t === "ContentSlotForPage" || t === "ContentSlotForTemplate") {
      const owner = t === "ContentSlotForPage" ? refValue(col("page")) : refValue(col("pageTemplate"));
      const slot = refValue(col("contentSlot"));
      if (owner && slot) pending.push({ type: "cms-ref", from: t === "ContentSlotForPage" ? `cms-page:${owner}` : `cms-template:${owner}`, uid: slot, targetKind: "cms-slot", kind: "places", ...at });
    } else if (/Component$/.test(t)) {
      const uid = col("uid");
      if (!uid) continue;
      const id = `cms-component:${uid}`;
      add({ id, kind: "cms-component", name: col("name") || uid, file: file.path, line: lineNo, meta: { uid, type: t } });
      pending.push({ type: "cms-type", from: id, typeCode: t, ...at });
    } else if (/CronJob$/.test(t)) {
      const code = col("code");
      if (!code) continue;
      const id = `cronjob:${code}`;
      const job = refValue(col("job"));
      add({ id, kind: "cronjob", name: code, file: file.path, line: lineNo, meta: { type: t, ...(job ? { job } : {}) } });
      if (job) pending.push({ type: "job-bean", from: id, bean: `job:${job}`, ...at });
    } else if (t === "ServicelayerJob") {
      const code = col("code");
      const spring = col("springId");
      if (code && spring) pending.push({ type: "bean-alias", alias: `job:${code}`, bean: spring, ...at });
    } else if (t === "Trigger") {
      const job = refValue(col("cronJob"));
      const cron = col("cronExpression");
      if (job && cron) add({ id: `cronjob:${job}`, kind: "cronjob", name: job, file: file.path, line: lineNo, meta: { schedule: cron } });
    }
  }
  return { elements: [...elements.values()], links: [], pending };
}
