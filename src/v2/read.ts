// Reads a repository at one commit for the inventory: every file a parser
// understands or should be listed, straight from git objects, with size caps
// so a very large repository can't exhaust the server's memory. Files over a
// cap are listed as unread rather than silently skipped.
import { listTree, readEntries } from "../server/repo";
import { MAX_FILE_BYTES, MAX_TOTAL_BYTES, fileRole } from "./inventory";
import type { SourceFile } from "./inventory/types";

export interface InventorySource {
  files: SourceFile[];
  unread: string[];
  total: number;
}

export async function readForInventory(dir: string, sha: string, caps = { file: MAX_FILE_BYTES, total: MAX_TOTAL_BYTES }): Promise<InventorySource> {
  const tree = await listTree(dir, sha);
  const wanted = tree.filter((e) => fileRole(e.path) !== "skip");
  // Code first, so if the total cap bites it's docs and config that wait, not controllers.
  const rank = (p: string) => (fileRole(p) === "parse" ? 0 : fileRole(p) === "unread" ? 1 : 2);
  wanted.sort((a, b) => rank(a.path) - rank(b.path) || a.path.localeCompare(b.path));
  const files: SourceFile[] = [];
  const unread: string[] = [];
  let bytes = 0;
  const batch: typeof wanted = [];
  const flush = async () => {
    const contents = await readEntries(dir, batch);
    batch.forEach((e, i) => {
      const content = contents[i];
      if (content === undefined || content.includes("\u0000")) return;
      files.push({ path: e.path, content });
    });
    batch.length = 0;
  };
  for (const e of wanted) {
    if (e.size > caps.file || bytes + e.size > caps.total) {
      unread.push(e.path);
      continue;
    }
    bytes += e.size;
    batch.push(e);
    if (batch.length >= 1500) await flush();
  }
  await flush();
  return { files, unread, total: tree.length };
}
