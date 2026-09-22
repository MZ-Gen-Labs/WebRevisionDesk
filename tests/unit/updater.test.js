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
  assert.match(source, /uninstallerBackup/);
  assert.match(source, /Filter "unins\*"/);
});

test("Windows installer is per-user and installs the portable payload", async () => {
  const source = await readFile(path.join(root, "installer", "WebRevisionDesk.iss"), "utf8");
  assert.match(source, /DefaultDirName=\{localappdata\}\\Programs\\WebRevisionDesk/);
  assert.match(source, /PrivilegesRequired=lowest/);
  assert.match(source, /release-electron\\WebRevisionDesk\\\*/);
});

test("macOS updater verifies, replaces, and relaunches the app bundle", async () => {
  const source = await readFile(path.join(root, "electron", "updater.sh"), "utf8");
  assert.match(source, /shasum -a 256/);
  assert.match(source, /WebRevisionDesk\.app/);
  assert.match(source, /open -n/);
  assert.match(source, /Library\/Logs\/WebRevisionDesk/);
  assert.match(source, /osascript/);
});

test("Electron selects macOS update ZIPs and starts the shell updater", async () => {
  const source = await readFile(path.join(root, "electron", "main.mjs"), "utf8");
  assert.ok(source.includes("-mac-${arch}\\\\.zip"));
  assert.match(source, /electron", "updater\.sh/);
  assert.match(source, /spawn\("\/bin\/sh"/);
  assert.match(source, /macInstallPath/);
  assert.match(source, /path\.resolve\(app\.getAppPath\(\), "\.\.", "\.\.", "\.\."\)/);
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
