// npm run sample: replays every example with no keys and checks each answer
// against the one recorded live in output_examples/.
import { readFileSync } from "node:fs";
import path from "node:path";
import { OUTPUT_DIR, listExamples, replayExample } from "../src/agent/sample";

let failed = 0;
for (const example of listExamples()) {
  const result = await replayExample(example.id);
  const recorded = JSON.parse(readFileSync(path.join(OUTPUT_DIR, `${example.id}.json`), "utf8"));
  const same = result.status === "success" && result.output!.answer === recorded.output.answer && result.output!.approved === recorded.output.approved;
  if (!same) failed++;
  console.log(`${same ? "✓" : "✗"} ${example.id}: approved=${result.output?.approved} confidence=${result.output?.confidence}, ${result.output?.claims.length ?? 0} cited claims → ${result.log_file}`);
  if (result.output) console.log(`  ${result.output.answer.slice(0, 240)}${result.output.answer.length > 240 ? "…" : ""}\n`);
  else console.log(`  ${result.error?.message}\n`);
}
process.exit(failed ? 1 : 0);
