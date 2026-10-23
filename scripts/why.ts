// Asks one "why" question from the command line and prints the answer.
//   npm run why -- owner/name "question" [path] [line]
import { runWhy } from "../src/agent/run";

const [repo, question, file, line] = process.argv.slice(2);
if (!repo || !question) {
  console.error('usage: npm run why -- owner/name "question" [path] [line]');
  process.exit(2);
}
const result = await runWhy({ repo, question, path: file, line: line ? Number(line) : undefined });
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.status === "success" ? 0 : 1;
