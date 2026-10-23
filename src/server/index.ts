// Cartograph server entry point. Routes and security live in app.ts / security.ts.
import { createApp } from "./app";
import { runtimeLabel } from "../config";
import { emitDrift } from "./events";
import { commentOnCommit } from "./github";
import { onDrift, startReviewJob } from "./jobs";
import { listRepos } from "./store";
import { ACCESS_TOKEN, PUBLIC_MODE } from "./security";

const PORT = Number(process.env.PORT ?? 8787);
const publicUrl = () => process.env.PUBLIC_URL?.replace(/\/+$/, "");
/** Links that only go to the private MCP client may carry the secret prefix. */
const privateBase = () => (publicUrl() ? `${publicUrl()}${ACCESS_TOKEN ? `/${ACCESS_TOKEN}` : ""}` : undefined);

// Drift fan-out: MCP Events subscribers (private links) + optional GitHub
// commit comment (public: never include the secret prefix there).
onDrift((report) => {
  void emitDrift(report, privateBase()).then((n) => n && console.log(`[events] ${report.id} → ${n} subscriber(s)`));
  void commentOnCommit(report, ACCESS_TOKEN ? undefined : publicUrl());
});

createApp({ port: PORT }).listen(PORT, () => {
  // Catch up on pushes whose webhooks arrived while we were down (restart, sleep).
  // A repo that's already at its branch tip costs one `git fetch` and no agent call.
  if (process.env.CARTOGRAPH_BRAIN !== "fixture") {
    for (const r of listRepos()) {
      if (r.repo.source === "github" && r.latestSha) startReviewJob(r.repo.key, { source: "manual" });
    }
  }
  console.log(`Cartograph on http://localhost:${PORT}  (MCP: /mcp, UI: /app)`);
  if (!ACCESS_TOKEN && !PUBLIC_MODE) console.warn("⚠ CARTOGRAPH_ACCESS_TOKEN is not set: remote access is disabled (the tunnel will 404 everything)");
  if (process.env.CARTOGRAPH_BRAIN !== "fixture") {
    console.log(`Agents run on ${runtimeLabel()}`);
  }
});
