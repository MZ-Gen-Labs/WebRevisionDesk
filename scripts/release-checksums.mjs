import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function addReleaseChecksum(releaseDirectory, artifactPath) {
  const fileName = path.basename(artifactPath);
  const digest = createHash("sha256").update(await readFile(artifactPath)).digest("hex");
  const checksumPath = path.join(releaseDirectory, "SHA256SUMS.txt");
  let lines = [];
  try {
    lines = (await readFile(checksumPath, "utf8")).split(/\r?\n/).filter(Boolean);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  lines = lines.filter((line) => path.basename(line.trim().split(/\s+/).at(-1)) !== fileName);
  lines.push(`${digest}  ${fileName}`);
  await writeFile(checksumPath, `${lines.join("\n")}\n`, "ascii");
  return digest;
}
