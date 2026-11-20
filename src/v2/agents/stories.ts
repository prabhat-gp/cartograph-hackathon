// The Story Writer: one approved feature in, one epic with its stories out.
// The checks after it are code, not a model: citations must be real elements
// of the feature's slices, and every entry point must be covered by a story
// (one repair turn asks for the missing ones; rules fill anything left).
import type { AgentRunStat } from "../../shared/graph";
import type { Inventory } from "../inventory/types";
import { type Domain, type Epic, type Feature, type Project, type Story, type StoryMode, newId } from "../project";
import { allSlices, renderSlice } from "../slices";
import { STORY_WRITER_PROMPT, StoryWriterSchema } from "./prompts";
import { type RunOptions, runV2Agent } from "./run";
import type { z } from "zod";

type Draft = z.infer<typeof StoryWriterSchema>["stories"][number];

export interface WriteInput {
  inv: Inventory;
  project: Project;
  domain: Domain;
  feature: Feature;
  excerpts: Map<string, string>;
  mode: StoryMode;
  target?: string;
}

export async function writeStories(input: WriteInput, opts: RunOptions = {}): Promise<{ epic: Epic; stats: AgentRunStat[] }> {
  const { inv, project, domain, feature } = input;
  const stats: AgentRunStat[] = [];
  const run: RunOptions = { ...opts, stats };
  const byId = new Map(inv.elements.map((e) => [e.id, e]));
  const slices = allSlices(inv);
  const entryIds = feature.entryIds.filter((id) => slices.has(id));
  const entryRef = new Map(entryIds.map((id, i) => [id, `e${i + 1}`]));
  const refEntry = new Map([...entryRef].map(([id, r]) => [r, id]));
  const elRef = new Map<string, string>();
  const ref = (id: string) => {
    if (!elRef.has(id)) elRef.set(id, `x${elRef.size + 1}`);
    return elRef.get(id)!;
  };
  const refEl = () => new Map([...elRef].map(([id, r]) => [r, id]));
  const modeLine = input.mode === "migrate" ? `Mode: migrate to ${input.target || "the target stack"}` : "Mode: as-is";
  const body = entryIds.map((id) => {
    const note = project.entries[id];
    const code = input.excerpts.get(id);
    return `ENTRY ${entryRef.get(id)}: ${note?.title ?? id}\n  ${note?.summary ?? ""} (actor: ${note?.actor ?? "User"})\n${renderSlice(slices.get(id)!, byId, ref)}${code ? `\n  code:\n${code.split("\n").slice(0, 20).map((l) => `    ${l}`).join("\n")}` : ""}`;
  });
  const prompt = [modeLine, `Application: ${project.repo.name} (${project.stack.join(", ")}) — ${project.summary}`, `Domain: ${domain.name} — ${domain.description}`, `Feature: ${feature.name} — ${feature.description}`, "", ...body].join("\n").slice(0, 90_000);

  let epicTitle = feature.name;
  let epicDescription = feature.description;
  let drafts: Draft[] = [];
  let by: Epic["by"] = "agent";
  const epicNotes: string[] = [];
  try {
    opts.onProgress?.(`Story Writer · ${feature.name}: ${entryIds.length} entry points, ${elRef.size} code elements`);
    const out = await runV2Agent("story-writer", `story-writer ${feature.name}`, STORY_WRITER_PROMPT, StoryWriterSchema, prompt, run);
    epicTitle = out.epic.title.trim() || epicTitle;
    epicDescription = out.epic.description.trim() || epicDescription;
    drafts = out.stories;
    const covered = new Set(drafts.flatMap((s) => s.entries));
    const missing = [...refEntry.keys()].filter((r) => !covered.has(r));
    if (missing.length) {
      opts.onProgress?.(`Reviewer · ${missing.length} entry points have no story; asking for them`);
      try {
        const more = await runV2Agent("story-writer", `story-writer ${feature.name} (missing)`, STORY_WRITER_PROMPT, StoryWriterSchema,
          `${prompt}\n\nStories already written: ${drafts.map((s) => `${s.ref} ${s.title}`).join("; ")}\nWrite stories ONLY for these entry points, which no story covers yet: ${missing.join(", ")}. Number the new stories from s${drafts.length + 1}.`, run);
        drafts.push(...more.stories.map((s, i) => ({ ...s, ref: drafts.some((d) => d.ref === s.ref) ? `s${drafts.length + i + 1}` : s.ref })));
      } catch (error) {
        opts.signal?.throwIfAborted();
        epicNotes.push(`The Story Writer didn't cover every entry point (${(error as Error).message.slice(0, 60)}); rules added the rest.`);
      }
    }
  } catch (error) {
    opts.signal?.throwIfAborted();
    by = "rule";
    epicNotes.push(`The Story Writer failed (${(error as Error).message.slice(0, 80)}). These stories were made by rule from the inventory: rewrite them before approving.`);
  }

  // ------------------------------------------------------------ checks (code, not a model)
  const elements = refEl();
  const storyIds = new Map<string, string>();
  const stories: Story[] = drafts.map((d) => {
    const id = newId("s");
    storyIds.set(d.ref, id);
    const notes: string[] = [];
    const cited = d.elements.map((r) => elements.get(r)).filter((x): x is string => !!x);
    const dropped = d.elements.length - cited.length;
    if (dropped) notes.push(`${dropped} citation${dropped > 1 ? "s" : ""} to code that doesn't exist removed.`);
    const entries = d.entries.map((r) => refEntry.get(r)).filter((x): x is string => !!x);
    if (!cited.length) {
      cited.push(...(entries.length ? entries : entryIds.slice(0, 1)));
      notes.push("The Story Writer cited no existing code; linked to the entry points instead.");
    }
    return { id, title: d.title.trim(), userStory: d.userStory.trim(), technical: d.technical.trim(), acceptance: d.acceptance.map((a) => a.trim()).filter(Boolean), elements: [...new Set(cited)], entries, dependsOn: d.dependsOn, size: d.size, status: "draft", by: "agent", ...(notes.length ? { notes } : {}) };
  });
  for (const s of stories) s.dependsOn = s.dependsOn.map((r) => storyIds.get(r)).filter((x): x is string => !!x && x !== s.id);
  const covered = new Set(stories.flatMap((s) => s.entries));
  for (const id of entryIds) {
    if (covered.has(id)) continue;
    const note = project.entries[id];
    const slice = slices.get(id)!;
    const el = byId.get(id)!;
    stories.push({
      id: newId("s"),
      title: note?.title ?? el.name,
      userStory: `As a ${note?.actor ?? "user"}, I want to ${(note?.title ?? el.name).replace(/^./, (c) => c.toLowerCase())}, so that ${feature.name.toLowerCase()} works end to end.`,
      technical: `${input.mode === "migrate" ? `Rebuild on ${input.target || "the target stack"}: ` : ""}${slice.steps.slice(0, 12).map((s) => byId.get(s.id)?.name).filter(Boolean).join(" → ")}.`,
      acceptance: ["The behaviour matches the existing implementation for the main path.", "Errors are handled and shown to the user.", "Automated tests cover the main path."],
      elements: slice.steps.slice(0, 12).map((s) => s.id),
      entries: [id],
      dependsOn: [],
      size: slice.steps.length > 25 ? "L" : slice.steps.length > 8 ? "M" : "S",
      status: "draft",
      by: "rule",
      notes: ["Made by rule from the inventory because no story covered this entry point. Rewrite before approving."],
    });
  }
  const epic: Epic = {
    id: newId("ep"),
    featureId: feature.id,
    domainId: domain.id,
    title: epicTitle,
    description: epicDescription,
    status: "draft",
    mode: input.mode,
    ...(input.mode === "migrate" && input.target ? { target: input.target } : {}),
    stories,
    createdAt: new Date().toISOString(),
    by,
    ...(epicNotes.length ? { notes: epicNotes } : {}),
  };
  return { epic, stats };
}
