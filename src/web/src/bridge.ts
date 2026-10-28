// One interface over two hosts:
//  - an MCP Apps host (Claude, Cursor and others): JSON-RPC over postMessage via the App client
//  - standalone (/app in a browser tab): plain REST calls to the Cartograph server
import { App } from "@modelcontextprotocol/ext-apps";

export type Theme = "light" | "dark";
export type DisplayMode = "inline" | "fullscreen" | "pip";

export interface ToolResult<T = Record<string, unknown>> {
  structuredContent: T;
  text?: string;
  isError?: boolean;
  /** Widget-only payload (_meta), e.g. the full graph. */
  meta?: Record<string, unknown>;
}

export interface HostState {
  theme: Theme;
  displayMode: DisplayMode;
  maxHeight?: number;
  platform?: string;
}

export interface Bridge {
  mode: "host" | "standalone";
  connect(): Promise<void>;
  callTool<T = Record<string, unknown>>(name: string, args?: Record<string, unknown>): Promise<ToolResult<T>>;
  /** Results of model-initiated tool calls that this view was rendered for. */
  onToolResult(cb: (r: ToolResult) => void): void;
  onToolInput(cb: (args: Record<string, unknown>) => void): void;
  onHostChange(cb: (s: HostState) => void): void;
  host(): HostState;
  sendMessage(text: string): Promise<void>;
  updateContext(text: string): Promise<void>;
  requestDisplayMode(mode: DisplayMode): Promise<void>;
  openLink(url: string): Promise<void>;
}

declare global {
  interface Window {
    __CARTOGRAPH_STANDALONE__?: boolean;
  }
}

function systemTheme(): Theme {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

class HostBridge implements Bridge {
  mode = "host" as const;
  private app = new App({ name: "Cartograph", version: "0.1.0" }, {}, { autoResize: true });
  private hostCbs: Array<(s: HostState) => void> = [];
  private pending: ToolResult[] = [];
  private resultCb?: (r: ToolResult) => void;

  constructor() {
    this.app.ontoolresult = (params) => {
      const r: ToolResult = {
        structuredContent: (params.structuredContent ?? {}) as Record<string, unknown>,
        text: params.content?.find((c) => c.type === "text")?.text,
        isError: params.isError,
        meta: (params as { _meta?: Record<string, unknown> })._meta,
      };
      if (this.resultCb) this.resultCb(r);
      else this.pending.push(r);
    };
    this.app.onhostcontextchanged = () => {
      const s = this.host();
      for (const cb of this.hostCbs) cb(s);
    };
  }

  async connect() {
    await this.app.connect();
  }

  async callTool<T>(name: string, args: Record<string, unknown> = {}): Promise<ToolResult<T>> {
    const res = await this.app.callServerTool({ name, arguments: args });
    const text = res.content?.find((c) => c.type === "text");
    return {
      structuredContent: (res.structuredContent ?? {}) as T,
      text: text && "text" in text ? text.text : undefined,
      isError: res.isError,
      meta: (res as { _meta?: Record<string, unknown> })._meta,
    };
  }

  onToolResult(cb: (r: ToolResult) => void) {
    this.resultCb = cb;
    for (const r of this.pending.splice(0)) cb(r);
  }

  onToolInput(cb: (args: Record<string, unknown>) => void) {
    this.app.ontoolinput = (p) => cb((p.arguments ?? {}) as Record<string, unknown>);
  }

  onHostChange(cb: (s: HostState) => void) {
    this.hostCbs.push(cb);
  }

  host(): HostState {
    const ctx = this.app.getHostContext();
    const dims = ctx?.containerDimensions as { maxHeight?: number; height?: number } | undefined;
    return {
      theme: (ctx?.theme as Theme | undefined) ?? systemTheme(),
      displayMode: (ctx?.displayMode as DisplayMode | undefined) ?? "inline",
      maxHeight: dims?.maxHeight ?? dims?.height,
      platform: ctx?.platform,
    };
  }

  async sendMessage(text: string) {
    await this.app.sendMessage({ role: "user", content: [{ type: "text", text }] });
  }

  async updateContext(text: string) {
    await this.app.updateModelContext({ content: [{ type: "text", text }] }).catch(() => undefined);
  }

  async requestDisplayMode(mode: DisplayMode) {
    await this.app.requestDisplayMode({ mode }).catch(() => undefined);
  }

  async openLink(url: string) {
    await this.app.openLink({ url }).catch(() => window.open(url, "_blank"));
  }
}

class StandaloneBridge implements Bridge {
  mode = "standalone" as const;
  private hostCbs: Array<(s: HostState) => void> = [];

  async connect() {
    window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener("change", () => {
      for (const cb of this.hostCbs) cb(this.host());
    });
  }

  async callTool<T>(name: string, args: Record<string, unknown> = {}): Promise<ToolResult<T>> {
    const res = await fetch(`api/tools/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(args),
    });
    const body = await res.json();
    if (!res.ok) return { structuredContent: {} as T, text: body.error, isError: true };
    return { structuredContent: body.structuredContent as T, text: body.text, meta: body.meta };
  }

  onToolResult() {}
  onToolInput() {}
  onHostChange(cb: (s: HostState) => void) {
    this.hostCbs.push(cb);
  }

  host(): HostState {
    return { theme: systemTheme(), displayMode: "fullscreen" };
  }

  async sendMessage(text: string) {
    // No chat outside an MCP host: show what would have been asked.
    console.info("[cartograph] would ask the assistant:", text);
  }
  async updateContext() {}
  async requestDisplayMode() {}
  async openLink(url: string) {
    window.open(url, "_blank", "noopener");
  }
}

/** A browser tab (/app), not an MCP host's iframe: there is no assistant chat to ask. */
export const isStandalone = () => !!window.__CARTOGRAPH_STANDALONE__ || window.parent === window;

export function createBridge(): Bridge {
  return isStandalone() ? new StandaloneBridge() : new HostBridge();
}
