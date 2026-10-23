// Run traces: one JSONL file per run in logs/, plus a readable line on
// stdout per event. Written as the run happens, never after the fact.
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

export interface TraceEvent {
  agent_name: string;
  action: string;
  input_summary: string;
  output_summary: string;
  target_agent?: string;
  status: "success" | "needs_revision" | "retry" | "error" | "skipped";
  confidence?: number;
  retry_count?: number;
  details?: Record<string, unknown>;
}

export interface TraceRecord extends TraceEvent {
  timestamp: string;
  run_id: string;
}

export class Trace {
  readonly events: TraceRecord[] = [];
  readonly file: string;

  constructor(readonly runId: string, dir = process.env.CARTOGRAPH_LOG_DIR ?? path.join(process.cwd(), "logs"), private quiet = false) {
    mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, `trace-${runId}.jsonl`);
  }

  emit(event: TraceEvent): TraceRecord {
    const record: TraceRecord = { timestamp: new Date().toISOString(), run_id: this.runId, ...event };
    this.events.push(record);
    appendFileSync(this.file, JSON.stringify(record) + "\n");
    if (!this.quiet) {
      const to = event.target_agent ? ` -> ${event.target_agent}` : "";
      console.log(`[${event.status === "error" ? "ERROR" : "INFO"}] run_id=${this.runId} ${event.agent_name}${to} ${event.action}: ${event.output_summary}`);
    }
    return record;
  }
}
