import { describe, expect, it } from "vitest";
import { collapseBlame, parseLog, renamedTarget } from "../src/ingest/git";
import { mentionedIssues } from "../src/ingest/github";

const A = "a".repeat(40);
const B = "b".repeat(40);

describe("collapseBlame", () => {
  it("merges adjacent groups from the same commit and splits on a different one", () => {
    const porcelain = [`${A} 1 1 2`, "author x", "\tline1", `${A} 2`, "\tline2", `${A} 5 3 1`, "\tline3", `${B} 9 4 2`, "\tline4", `${B} 10`, "\tline5"].join("\n");
    expect(collapseBlame(porcelain)).toEqual([
      { lineStart: 1, lineEnd: 3, commitSha: A },
      { lineStart: 4, lineEnd: 5, commitSha: B },
    ]);
  });
});

describe("parseLog", () => {
  it("reads commits with numstat lines, including binary files and renames", () => {
    const out = `\x1e${A}\x1fAda\x1fada@x.org\x1f2026-10-01T10:00:00+00:00\x1fFix retry (#12)\x1fBody line\n\x1f\n3\t1\tsrc/a.ts\n-\t-\timg.png\n2\t0\tsrc/{old => new}/b.ts\n`;
    expect(parseLog(out)).toEqual([{
      sha: A, authorName: "Ada", authorEmail: "ada@x.org", authoredAt: "2026-10-01T10:00:00+00:00", subject: "Fix retry (#12)", body: "Body line",
      files: [{ path: "src/a.ts", additions: 3, deletions: 1 }, { path: "img.png", additions: 0, deletions: 0 }, { path: "src/new/b.ts", additions: 2, deletions: 0 }],
    }]);
  });

  it("resolves both rename forms", () => {
    expect(renamedTarget("old.ts => new.ts")).toBe("new.ts");
    expect(renamedTarget("lib/{a => }/c.ts")).toBe("lib/c.ts");
  });
});

describe("mentionedIssues", () => {
  it("finds short, qualified and URL references to the same repository only", () => {
    const text = "Refs #12 and sindresorhus/ky#40, see https://github.com/sindresorhus/ky/issues/7 but not other/repo#99 or abc#5";
    expect(mentionedIssues("sindresorhus/ky", text).sort((a, b) => a - b)).toEqual([7, 12, 40]);
  });
});
