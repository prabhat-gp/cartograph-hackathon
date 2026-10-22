// Codex runtime: every Cartograph agent can run as a `codex exec` call on the
// user's ChatGPT plan instead of the paid API. Same prompts, same schemas; the
// pipeline in map.ts / review.ts / trace.ts doesn't know the difference.
//
// Each call runs in a read-only sandbox inside an empty temp directory: the
// agent gets its input in the prompt and cannot read or change anything else.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";

const CODEX_BIN = process.env.CARTOGRAPH_CODEX_BIN ?? "codex";
const TIMEOUT_MS = Number(process.env.CARTOGRAPH_CODEX_TIMEOUT_MS ?? 8 * 60_000);

/** Codex unless an API key is configured (or CARTOGRAPH_RUNTIME says otherwise). */
export function codexRuntime(): boolean {
  const forced = process.env.CARTOGRAPH_RUNTIME;
  if (forced === "codex") return true;
  if (forced === "api") return false;
  return !process.env.OPENAI_API_KEY;
}

const UNSUPPORTED = ["$schema", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minItems", "maxItems", "minLength", "maxLength", "pattern", "format", "default"];

/** Reduce a JSON Schema to the strict subset structured outputs accept. */
function strictify(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictify);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (UNSUPPORTED.includes(k)) continue;
    out[k] = k === "properties" ? Object.fromEntries(Object.entries(v as object).map(([p, s]) => [p, strictify(s)])) : strictify(v);
  }
  if (out.type === "object" && out.properties) {
    out.additionalProperties = false;
    out.required = Object.keys(out.properties as object);
  }
  return out;
}

export function strictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return strictify(z.toJSONSchema(schema)) as Record<string, unknown>;
}

export interface CodexUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface CodexCall {
  instructions: string;
  input: string;
  schema: z.ZodType;
  model: string;
  effort: "low" | "medium" | "high";
  signal?: AbortSignal;
  onUsage?: (usage: CodexUsage) => void;
}

/** Run one structured agent turn through `codex exec` and return the parsed JSON. */
export async function runCodex({ instructions, input, schema, model, effort, signal, onUsage }: CodexCall): Promise<unknown> {
  signal?.throwIfAborted();
  const dir = await mkdtemp(path.join(tmpdir(), "cartograph-codex-"));
  const schemaPath = path.join(dir, "schema.json");
  const outPath = path.join(dir, "out.json");
  try {
    await writeFile(schemaPath, JSON.stringify(strictJsonSchema(schema)));
    const prompt =
      `${instructions}\n\n` +
      "Everything you need is in the input below. Do not run shell commands or read files: " +
      "answer directly with JSON that matches the output schema.\n\n# Input\n" +
      input;

    // Never let Codex fall back to API-key billing: it must use the ChatGPT login.
    const env = { ...process.env };
    delete env.OPENAI_API_KEY;

    const args = [
      "exec",
      "-m", model,
      "-c", `model_reasoning_effort="${effort}"`,
      "-s", "read-only",
      "--ephemeral",
      "--skip-git-repo-check",
      "-C", dir,
      "--output-schema", schemaPath,
      "-o", outPath,
      "--json",
      "-",
    ];

    await new Promise<void>((resolve, reject) => {
      const child = spawn(CODEX_BIN, args, { env, stdio: ["pipe", "pipe", "pipe"] });
      let stderr = "";
      let buffer = "";
      let failure: string | undefined;
      const timer = setTimeout(() => {
        failure = `codex exec timed out after ${Math.round(TIMEOUT_MS / 1000)}s`;
        child.kill("SIGTERM");
      }, TIMEOUT_MS);
      const onAbort = () => {
        failure = "aborted";
        child.kill("SIGTERM");
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      child.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          try {
            const event = JSON.parse(line) as { type?: string; usage?: Record<string, number>; message?: string; error?: { message?: string } };
            if (event.type === "turn.completed" && event.usage) {
              onUsage?.({
                inputTokens: event.usage.input_tokens ?? 0,
                outputTokens: (event.usage.output_tokens ?? 0) + (event.usage.reasoning_output_tokens ?? 0),
              });
            } else if (event.type === "turn.failed" || event.type === "error") {
              failure = event.error?.message ?? event.message ?? "codex reported an error";
            }
          } catch {
            /* non-JSON progress line: ignore */
          }
        }
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-4000);
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        reject(new Error(`Could not start Codex (${err.message}). Is the Codex CLI installed and logged in?`));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        if (failure === "aborted") return reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        if (code !== 0 || failure) {
          const detail = failure ?? stderr.trim().split("\n").slice(-3).join(" ");
          return reject(new Error(`codex exec failed: ${detail || `exit code ${code}`}`));
        }
        resolve();
      });
      child.stdin.end(prompt);
    });

    return JSON.parse(await readFile(outPath, "utf8"));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
