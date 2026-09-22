import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("Electron stages a BOM-prefixed updater outside the install directory", async () => {
  const source = await readFile(path.join(root, "electron", "main.mjs"), "utf8");
  assert.match(source, /path\.join\(app\.getPath\("temp"\), "WebRevisionDesk"\)/);
  assert.match(source, /writeFile\(script, `\\uFEFF\$\{scriptBody\}`/);
  assert.match(source, /"-TemporaryScriptPath", script/);
  assert.match(source, /spawn\(launcher, \["\/d", "\/c", launcherScript\]/);
  assert.match(source, /cwd: updaterDirectory/);
  assert.match(source, /jsonResponse\(await applyDownloadedUpdate\(\)\)/);
});

test("updater records progress and displays failures", async () => {
  const source = await readFile(path.join(root, "electron", "updater.ps1"), "utf8");
  assert.match(source, /WebRevisionDesk\\logs/);
  assert.match(source, /updater\.log/);
  assert.match(source, /System\.Windows\.MessageBox/);
  assert.doesNotMatch(source, /Get-FileHash/);
  assert.match(source, /Security\.Cryptography\.SHA256/);
  assert.match(source, /TemporaryScriptPath/);
});

test("BOM-prefixed updater parses in Windows PowerShell", { skip: process.platform !== "win32" }, async () => {
  const source = (await readFile(path.join(root, "electron", "updater.ps1"), "utf8")).replace(/^\uFEFF/, "");
  const temporaryScript = path.join(os.tmpdir(), `WebRevisionDesk-updater-parse-${process.pid}.ps1`);
  await writeFile(temporaryScript, `\uFEFF${source}`, "utf8");
  try {
    const quotedPath = temporaryScript.replaceAll("'", "''");
    const command = `$null = [scriptblock]::Create((Get-Content -Raw -LiteralPath '${quotedPath}'))`;
    const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    await rm(temporaryScript, { force: true });
  }
});
