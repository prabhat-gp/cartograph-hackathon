// V2 inventory: every piece of an application the parsers can see, with the
// file and line that proves it, and the links between them. No model is
// involved anywhere in this folder: the same commit always gives the same
// inventory, which is what lets the completeness gate count against it.

export const ELEMENT_KINDS = [
  // Java / Spring / SAP Commerce
  "controller", "cms-controller", "endpoint", "facade", "service", "dao", "populator", "converter",
  "interceptor", "job", "event-listener", "process-action", "model", "config", "class", "interface",
  "method", "bean", "item-type", "extension", "business-process", "cronjob",
  // Views and CMS
  "jsp-page", "jsp-tag", "cms-page", "cms-template", "cms-slot", "cms-component",
  // JavaScript / React
  "route", "component", "hook", "function", "store", "api-call",
] as const;
export type ElementKind = (typeof ELEMENT_KINDS)[number];

/** Kinds that start a piece of functionality: a user, a schedule or the system calls them. */
export const ENTRY_KINDS: ReadonlySet<ElementKind> = new Set<ElementKind>([
  "endpoint", "route", "cronjob", "business-process", "event-listener",
]);

export const LINK_KINDS = [
  "contains",   // class → method, file-level parent → child
  "calls",      // method → method, component → function
  "injects",    // class or bean → bean it depends on
  "implements", "extends",
  "defines",    // bean → class it instantiates
  "renders",    // endpoint → jsp, component → component, route → component
  "includes",   // jsp → jsp or tag
  "uses",       // component → hook, page → template, cms → controller
  "places",     // page or template → slot, slot → component
  "populates",  // converter → populator
  "http",       // api-call → endpoint
  "requires",   // extension → extension
  "runs",       // cronjob or process → bean/class doing the work
] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export interface InventoryElement {
  /** Stable across scans of the same code: "java:com.acme.CartController#addToCart". */
  id: string;
  kind: ElementKind;
  name: string;
  file: string;
  line: number;
  endLine?: number;
  /** The element this one sits inside, e.g. a method's class. */
  parent?: string;
  /** Short facts for display and for the agents: HTTP paths, bean ids, annotations… */
  meta?: Record<string, string | string[]>;
}

export interface InventoryLink {
  from: string;
  to: string;
  kind: LinkKind;
  /** Where the link is written down. */
  file: string;
  line: number;
}

export type FileStatus = "parsed" | "read" | "unread";

export interface InventoryFile {
  path: string;
  /** parsed: produced elements; read: understood but nothing to list; unread: no parser for it. */
  status: FileStatus;
  parser?: string;
  elements: number;
  lines: number;
}

export interface Inventory {
  version: 1;
  repo: string;
  sha: string;
  generatedAt: string;
  stack: string[];
  elements: InventoryElement[];
  links: InventoryLink[];
  entryPoints: string[];
  files: InventoryFile[];
  stats: {
    elements: number;
    links: number;
    entryPoints: number;
    files: number;
    parsedFiles: number;
    unreadFiles: number;
    byKind: Partial<Record<ElementKind, number>>;
    /** Calls the linker could not tie to a known element (library code, dynamic dispatch). */
    unresolvedCalls: number;
  };
}

export interface SourceFile {
  path: string;
  content: string;
}

/** What each parser hands back for one file before linking. */
export interface ParsedFile {
  elements: InventoryElement[];
  links: InventoryLink[];
  /** Facts the linker needs that aren't elements yet (calls, bean refs, view names). */
  pending: PendingRef[];
}

export type PendingRef =
  | { type: "java-call"; from: string; receiver?: string; receiverType?: string; receiverBean?: string; method: string; file: string; line: number }
  | { type: "java-new"; from: string; className: string; file: string; line: number }
  | { type: "java-type"; from: string; typeName: string; kind: "implements" | "extends" | "injects"; bean?: string; file: string; line: number }
  | { type: "java-view"; from: string; expr: string; file: string; line: number }
  | { type: "java-cms-page"; from: string; expr: string; file: string; line: number }
  | { type: "java-process"; from: string; args: string[]; file: string; line: number }
  | { type: "bean-class"; from: string; className: string; file: string; line: number }
  | { type: "bean-ref"; from: string; bean: string; kind: LinkKind; file: string; line: number }
  | { type: "bean-alias"; alias: string; bean: string; file: string; line: number }
  | { type: "jsp-include"; from: string; target: string; file: string; line: number }
  | { type: "jsp-tag"; from: string; tagdir: string; tag: string; file: string; line: number }
  | { type: "cms-ref"; from: string; uid: string; targetKind: "cms-page" | "cms-template" | "cms-slot" | "cms-component"; kind: LinkKind; file: string; line: number }
  | { type: "cms-view"; from: string; view: string; file: string; line: number }
  | { type: "cms-type"; from: string; typeCode: string; file: string; line: number }
  | { type: "item-ref"; from: string; typeCode: string; kind: LinkKind; file: string; line: number }
  | { type: "ext-ref"; from: string; extension: string; file: string; line: number }
  | { type: "ts-ref"; from: string; module?: string; name: string; member?: string; kind: LinkKind; file: string; line: number }
  | { type: "http-call"; from: string; method: string; url: string; file: string; line: number }
  | { type: "job-bean"; from: string; bean: string; file: string; line: number };
