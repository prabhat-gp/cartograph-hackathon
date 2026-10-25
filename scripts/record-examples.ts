// Runs each input_examples/*.json live (Zetaris + the models) and saves the
// result to output_examples/, the trace to logs/, and the recording that
// SAMPLE_MODE replays to samples/.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { OUTPUT_DIR, listExamples, recordExample } from "../src/agent/sample";

mkdirSync(OUTPUT_DIR, { recursive: true });
const only = process.argv[2];
for (const example of listExamples().filter((e) => !only || e.id === only)) {
  const result = await recordExample(example);
  writeFileSync(path.join(OUTPUT_DIR, `${example.id}.json`), JSON.stringify(result, null, 2) + "\n");
  console.log(`${example.id}: approved=${result.output!.approved} confidence=${result.output!.confidence} in ${result.execution_time_seconds}s → ${result.log_file}`);
}
