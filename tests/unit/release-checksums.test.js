import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { addReleaseChecksum } from "../../scripts/release-checksums.mjs";

test("release checksum updates are idempotent and preserve other assets", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "wrd-release-checksums-"));
  try {
    const setup = path.join(directory, "WebRevisionDesk-0.7.17-Setup.exe");
    const patch = path.join(directory, "WebRevisionDesk-0.7.17-Patch-Setup.exe");
    await writeFile(setup, "full installer");
    await writeFile(patch, "patch installer");
    await writeFile(path.join(directory, "SHA256SUMS.txt"), "oldhash  WebRevisionDesk-0.7.17-Setup.exe\nziphash  app.zip\n");

    await addReleaseChecksum(directory, setup);
    await addReleaseChecksum(directory, patch);
    await addReleaseChecksum(directory, setup);
    const lines = (await readFile(path.join(directory, "SHA256SUMS.txt"), "utf8")).trim().split("\n");
    assert.equal(lines.length, 3);
    assert.ok(lines.some((line) => line.endsWith("WebRevisionDesk-0.7.17-Setup.exe")));
    assert.ok(lines.some((line) => line.endsWith("WebRevisionDesk-0.7.17-Patch-Setup.exe")));
    assert.ok(lines.some((line) => line === "ziphash  app.zip"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
