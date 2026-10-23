// GitHub push webhooks → incremental architecture review, plus an optional
// commit comment when a push introduces drift.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { type DriftReport, shortSha } from "../shared/graph";
import { startReviewJob } from "./jobs";
import { resolveRepo } from "./repo";
import { isRemote } from "./security";
import { getRepo } from "./store";

function validSignature(raw: Buffer, header: string | undefined, secret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`);
  const got = Buffer.from(header);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

/** Express handler; mount with express.raw() so the body is the exact bytes GitHub signed. */
export function githubWebhook(req: Request, res: Response): void {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (secret ? !validSignature(raw, req.header("x-hub-signature-256"), secret) : isRemote(req)) {
    res.status(401).json({ error: secret ? "bad signature" : "webhook secret not configured" });
    return;
  }

  const event = req.header("x-github-event");
  if (event === "ping") {
    res.json({ ok: true, message: "Cartograph is listening" });
    return;
  }
  if (event !== "push") {
    res.status(202).json({ ignored: event });
    return;
  }

  let payload: {
    ref?: string;
    after?: string;
    deleted?: boolean;
    repository?: { html_url?: string; full_name?: string };
  };
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    res.status(400).json({ error: "invalid JSON" });
    return;
  }
  if (payload.deleted || !payload.after || /^0+$/.test(payload.after)) {
    res.status(202).json({ ignored: "branch deletion" });
    return;
  }

  const repo = resolveRepo(payload.repository?.html_url ?? payload.repository?.full_name ?? "");
  const record = getRepo(repo.key);
  if (!record?.latestSha) {
    res.status(202).json({ ignored: `${repo.name} is not mapped yet` });
    return;
  }
  const branch = payload.ref?.replace(/^refs\/heads\//, "");
  if (record.branch && branch && branch !== record.branch) {
    res.status(202).json({ ignored: `push to ${branch}; watching ${record.branch}` });
    return;
  }

  const job = startReviewJob(repo.key, { toSha: payload.after, source: "github" });
  console.log(`[github] push to ${repo.name}@${shortSha(payload.after)} → ${job?.id}`);
  res.status(202).json({ jobId: job?.id });
}

/** Comment on the head commit of a drifting push (needs GITHUB_TOKEN). */
export async function commentOnCommit(report: DriftReport, publicUrl?: string): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  const record = getRepo(report.repoKey);
  // Only repositories the owner opted in: the token can comment on anyone's public commits.
  const optedIn = (process.env.CARTOGRAPH_COMMENT_REPOS ?? "").split(",").map((r) => r.trim().toLowerCase());
  if (!token || record?.repo.source !== "github" || report.maxSeverity === "none") return;
  if (!optedIn.includes(record.repo.name.toLowerCase())) return;

  const icon = report.maxSeverity === "critical" ? "🔴" : report.maxSeverity === "warning" ? "🟠" : "🔵";
  const body = [
    `### ${icon} Cartograph: architecture drift in \`${shortSha(report.toSha)}\``,
    "",
    report.summary,
    "",
    ...report.findings.slice(0, 6).map((f) => `- **${f.severity.toUpperCase()}**: ${f.title}. ${f.detail}`),
    "",
    publicUrl ? `[Open in Cartograph](${publicUrl}/app?repo=${encodeURIComponent(report.repoKey)}&drift=${report.id})` : "",
  ].join("\n");

  const res = await fetch(`https://api.github.com/repos/${record.repo.name}/commits/${report.toSha}/comments`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "cartograph" },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) console.warn(`[github] commit comment failed: ${res.status} ${await res.text()}`);
}
