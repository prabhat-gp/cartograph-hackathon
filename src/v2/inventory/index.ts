// buildInventory: every file of a repository through the parser for its type,
// then the linker. Files no parser understands are listed as unread, never
// dropped, so "nothing missed" can be checked by a person.
import { type JavaUnit, parseJava } from "./java";
import { parseJsp, parseTemplate } from "./jsp";
import { parseImpex } from "./impex";
import { linkInventory } from "./link";
import { type TsModule, parseTs } from "./react";
import { ENTRY_KINDS, type ElementKind, type Inventory, type InventoryElement, type InventoryFile, type InventoryLink, type PendingRef, type SourceFile } from "./types";
import { parseXml } from "./xml";

/** Not the application's own code: dependencies, build output, generated and SAP platform code, tests. */
const SKIP = /(^|\/)(node_modules|bower_components|dist|build|out|target|classes|gensrc|\.next|\.nuxt|\.svelte-kit|coverage|vendor|\.git|\.idea|\.vscode|\.gradle|\.mvn|__pycache__|\.venv|venv|storybook-static|testsrc|__tests__|__mocks__|mocks?|testing|test-utils|e2e|cypress|playwright)(\/|$)|(^|\/)bin\/(platform|modules)\/|(^|\/)src\/test\/|(\.min\.(js|css)|\.map|\.d\.ts|\.(test|spec|stories)\.[jt]sx?)$/i;
/** Code or templates no parser reads yet: listed as unread so coverage stays honest. */
const UNREAD_EXT = /\.(kt|kts|groovy|scala|py|rb|go|php|cs|vue|svelte|swift|rs|vm|ftl|html?|mustache|hbs|ejs|astro|dart|clj|ex|exs|jsx?\.erb)$/i;
/** Configuration and docs: read for the stack, nothing to list. */
const READ_EXT = /\.(properties|ya?ml|json|toml|gradle|sql|md|mdx|env\.example|conf|cfg|ini|txt|csv|graphql|gql|proto|prisma|less|s?css|sass)$/i;
const PARSED_EXT = /\.(java|xml|jspf?|tagx?|impex|[cm]?[jt]sx?)$|\/templates\/.+\.html$/i;

export const MAX_FILE_BYTES = 1_000_000;
export const MAX_TOTAL_BYTES = 80_000_000;

export type FileRole = "parse" | "read" | "unread" | "skip";

export function fileRole(p: string): FileRole {
  if (SKIP.test(p)) return "skip";
  if (PARSED_EXT.test(p)) return "parse";
  if (UNREAD_EXT.test(p)) return "unread";
  if (READ_EXT.test(p) || /(^|\/)(Dockerfile|Makefile|Procfile)$/.test(p)) return "read";
  return "skip";
}

function detectStack(files: SourceFile[], elements: InventoryElement[]): string[] {
  const stack = new Set<string>();
  const kinds = new Set(elements.map((e) => e.kind));
  const anyFile = (re: RegExp) => files.some((f) => re.test(f.path));
  const anyContent = (fileRe: RegExp, re: RegExp) => files.some((f) => fileRe.test(f.path) && re.test(f.content));
  if (anyFile(/(^|\/)extensioninfo\.xml$/) || anyFile(/-items\.xml$/) || anyFile(/\.impex$/)) stack.add("SAP Commerce");
  if (anyFile(/\/(\w+storefront)\//i) && anyFile(/\.jsp$/)) stack.add("Accelerator storefront");
  if (anyContent(/\.java$/, /@SpringBootApplication/)) stack.add("Spring Boot");
  if (anyContent(/\.java$/, /org\.springframework/)) stack.add("Spring");
  if (anyFile(/\.java$/)) stack.add("Java");
  if (anyFile(/\.jspf?$/)) stack.add("JSP");
  if (anyContent(/\/templates\/.+\.html$/, /xmlns:th=|th:(text|href|each|replace|insert)/)) stack.add("Thymeleaf");
  if (anyContent(/\.[cm]?[jt]sx?$/, /from\s+["']react["']|require\(["']react["']\)/)) stack.add("React");
  if (anyContent(/(^|\/)package\.json$/, /"next"\s*:/)) stack.add("Next.js");
  if (anyContent(/\.[cm]?[jt]sx?$/, /from\s+["']react-router(-dom)?["']/)) stack.add("React Router");
  if (anyContent(/\.[cm]?[jt]sx?$/, /from\s+["']express["']|require\(["']express["']\)/)) stack.add("Express");
  if (anyFile(/\.tsx?$/)) stack.add("TypeScript");
  if (kinds.has("store") && anyContent(/\.[jt]sx?$/, /@reduxjs\/toolkit|from\s+["']redux["']/)) stack.add("Redux");
  return [...stack];
}

export function buildInventory(repo: string, sha: string, files: SourceFile[], extra: { unread?: string[]; read?: string[] } = {}): Inventory {
  const elements: InventoryElement[] = [];
  const links: InventoryLink[] = [];
  const pending: PendingRef[] = [];
  const javaUnits: JavaUnit[] = [];
  const tsModules: TsModule[] = [];
  const fileRows: InventoryFile[] = [];
  const next = files.some((f) => /(^|\/)package\.json$/.test(f.path) && /"next"\s*:/.test(f.content));
  for (const file of files) {
    const lines = file.content.split("\n").length;
    const role = fileRole(file.path);
    if (role !== "parse") {
      if (role === "read" || role === "unread") fileRows.push({ path: file.path, status: role, elements: 0, lines });
      continue;
    }
    let parser = "";
    let out: { elements: InventoryElement[]; links: InventoryLink[]; pending: PendingRef[] };
    try {
      if (/\.java$/i.test(file.path)) {
        parser = "java";
        const r = parseJava(file);
        javaUnits.push(r.unit);
        out = r;
      } else if (/\.xml$/i.test(file.path)) {
        const r = parseXml(file);
        parser = r.xmlKind === "other" ? "xml" : `xml:${r.xmlKind}`;
        out = r;
      } else if (/\.(jspf?|tagx?)$/i.test(file.path)) {
        parser = "jsp";
        out = parseJsp(file);
      } else if (/\.html$/i.test(file.path)) {
        parser = "thymeleaf";
        out = parseTemplate(file);
      } else if (/\.impex$/i.test(file.path)) {
        parser = "impex";
        out = parseImpex(file);
      } else {
        parser = "react";
        const r = parseTs(file, { next });
        tsModules.push(r.module);
        out = r;
      }
    } catch (error) {
      fileRows.push({ path: file.path, status: "unread", parser: `${parser} failed: ${(error as Error).message.slice(0, 80)}`, elements: 0, lines });
      continue;
    }
    elements.push(...out.elements);
    links.push(...out.links);
    pending.push(...out.pending);
    fileRows.push({ path: file.path, status: out.elements.length ? "parsed" : "read", parser, elements: out.elements.length, lines });
  }
  for (const p of extra.unread ?? []) fileRows.push({ path: p, status: "unread", parser: "too large to read", elements: 0, lines: 0 });
  for (const p of extra.read ?? []) fileRows.push({ path: p, status: "read", elements: 0, lines: 0 });

  const linked = linkInventory({ elements, links, pending, javaUnits, tsModules, paths: new Set(files.map((f) => f.path)) });
  const counts = new Map<string, number>();
  for (const el of linked.elements) counts.set(el.file, (counts.get(el.file) ?? 0) + 1);
  for (const row of fileRows) if (row.status !== "unread") {
    row.elements = counts.get(row.path) ?? 0;
    row.status = row.elements ? "parsed" : "read";
  }
  linked.elements.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  fileRows.sort((a, b) => a.path.localeCompare(b.path));
  const entryPoints = linked.elements.filter((e) => ENTRY_KINDS.has(e.kind)).map((e) => e.id);
  const byKind: Partial<Record<ElementKind, number>> = {};
  for (const el of linked.elements) byKind[el.kind] = (byKind[el.kind] ?? 0) + 1;
  return {
    version: 1,
    repo,
    sha,
    generatedAt: new Date().toISOString(),
    stack: detectStack(files, linked.elements),
    elements: linked.elements,
    links: linked.links,
    entryPoints,
    files: fileRows,
    stats: {
      elements: linked.elements.length,
      links: linked.links.length,
      entryPoints: entryPoints.length,
      files: fileRows.length,
      parsedFiles: fileRows.filter((f) => f.status === "parsed").length,
      unreadFiles: fileRows.filter((f) => f.status === "unread").length,
      byKind,
      unresolvedCalls: linked.unresolvedCalls,
    },
  };
}

export type { Inventory, InventoryElement, InventoryLink } from "./types";
