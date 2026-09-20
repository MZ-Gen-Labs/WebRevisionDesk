import { rm, rmdir, stat } from "node:fs/promises";

export async function removeProjectEntry(target, recursive = false) {
  const entry = await stat(target);
  if (entry.isDirectory() && !recursive) {
    await rmdir(target);
    return;
  }
  await rm(target, { recursive, force: false });
}
