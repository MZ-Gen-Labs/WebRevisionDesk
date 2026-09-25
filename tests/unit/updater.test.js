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
  assert.match(source, /Remove-Item -LiteralPath \$ZipPath -Force/);
  assert.match(source, /\$ZipPath\.retry/);
});

test("Windows updater replaces only resources/app for verified patch packages", async () => {
  const source = await readFile(path.join(root, "electron", "updater.ps1"), "utf8");
  assert.match(source, /\[switch\]\$Patch/);
  assert.match(source, /Join-Path \$stage "resources\\app"/);
  assert.match(source, /Join-Path \$InstallDirectory "resources\\app"/);
  assert.match(source, /差分更新ファイルのバージョンが一致しません/);
  assert.match(source, /if \(-not \$Patch -and \(Test-Path -LiteralPath \$uninstallerBackup\)\)/);
  const main = await readFile(path.join(root, "electron", "main.mjs"), "utf8");
  assert.match(main, /updaterArguments\.push\("-Patch", "-ExpectedVersion", downloadedUpdate\.version\)/);
  assert.match(main, /canApplyWindowsPatch\(installDirectory\)/);
  assert.match(main, /patch-checksum-mismatch/);
  assert.match(main, /fullExpectedSha256/);
});

test("release build publishes app-only patch metadata and both checksums", async () => {
  const builder = await readFile(path.join(root, "scripts", "build-electron-migration.mjs"), "utf8");
  assert.match(builder, /WebRevisionDesk-\$\{packageJson\.version\}-patch\.zip/);
  assert.match(builder, /targetElectronVersion: electronPackage\.version/);
  assert.match(builder, /assets: \{ full, patch \}/);
  assert.match(builder, /cp\(application, path\.join\(patchResources, "app"\), \{ recursive: true \}\)/);
  const workflow = await readFile(path.join(root, ".github", "workflows", "release.yml"), "utf8");
  assert.match(workflow, /release-electron\/release\.json/);
  assert.match(workflow, /-name 'release\.json'/);
  assert.match(workflow, /Get-ChildItem release-electron -Filter \*-electron-win-x64\.zip/);
  assert.match(workflow, /update-patch-smoke\.sh/);
  const ciWorkflow = await readFile(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
  assert.match(ciWorkflow, /update-patch-smoke\.ps1/);
  for (const script of ["build-electron-mac.mjs", "build-electron-feasibility.mjs"]) {
    const source = await readFile(path.join(root, "scripts", script), "utf8");
    assert.match(source, /update-package\.js/);
  }
});

test("Windows installer is per-user and installs the portable payload", async () => {
  const source = await readFile(path.join(root, "installer", "WebRevisionDesk.iss"), "utf8");
  assert.match(source, /DefaultDirName=\{localappdata\}\\Programs\\WebRevisionDesk/);
  assert.match(source, /PrivilegesRequired=lowest/);
  assert.match(source, /release-electron\\WebRevisionDesk\\\*/);
  assert.match(source, /CloseApplications=force/);
  assert.match(source, /function InitializeSetup: Boolean;/);
  assert.match(source, /function InitializeUninstall: Boolean;/);
  assert.match(source, /taskkill\.exe/);
  assert.match(source, /\/F \/T \/IM WebRevisionDesk\.exe/);
  assert.match(source, /for Attempt := 1 to 40 do/);
  assert.match(source, /WizardSilent/);
  assert.match(source, /UninstallSilent/);
  assert.equal((source.match(/^AppVersion=/gm) || []).length, 1);
});

test("Windows patch installer targets compatible installs only and publishes checksums", async () => {
  const source = await readFile(path.join(root, "installer", "WebRevisionDesk-Patch.iss"), "utf8");
  assert.match(source, /AppId=\{\{0D4F9CE2-C8DB-4A38-95A4-AEA5C81D22D1\}/);
  assert.match(source, /AppVersion=\{#MyAppVersion\}/);
  assert.match(source, /DisableDirPage=yes/);
  assert.match(source, /resources\\app\\\*/);
  assert.match(source, /CompareVersions\(InstalledVersion, MinimumVersion\) < 0/);
  assert.match(source, /CompareVersions\(InstalledVersion, TargetVersion\) >= 0/);
  assert.match(source, /function PrepareToInstall\(var NeedsRestart: Boolean\): String;/);
  assert.match(source, /StopRunningApplication/);
  const baseline = JSON.parse(await readFile(path.join(root, "installer", "windows-patch-baseline.json"), "utf8"));
  assert.equal(baseline.minimumAppVersion, "0.7.10");
  assert.equal(baseline.electronVersion, "44.4.3");
  const builder = await readFile(path.join(root, "scripts", "build-windows-patch-installer.mjs"), "utf8");
  assert.match(builder, /electronPackage\.version !== baseline\.electronVersion/);
  assert.match(builder, /Patch-from-\$\{baseline\.minimumAppVersion\}\+/);
  assert.match(builder, /10 \* 1024 \* 1024/);
  const workflow = await readFile(path.join(root, ".github", "workflows", "release.yml"), "utf8");
  assert.match(workflow, /build:windows:installer:patch/);
  assert.match(workflow, /update-patch-installer-smoke\.ps1/);
});

test("macOS updater verifies, replaces, and relaunches the app bundle", async () => {
  const source = await readFile(path.join(root, "electron", "updater.sh"), "utf8");
  assert.match(source, /shasum -a 256/);
  assert.match(source, /WebRevisionDesk\.app/);
  assert.match(source, /open -n/);
  assert.match(source, /Library\/Logs\/WebRevisionDesk/);
  assert.match(source, /osascript/);
  assert.match(source, /ZIP_PATH\.retry/);
  assert.match(source, /rm -f "\$ZIP_PATH" "\$ZIP_PATH\.retry"/);
  assert.match(source, /--patch\)/);
  assert.match(source, /--expected-version\)/);
  assert.match(source, /Contents\/Resources\/app/);
  assert.match(source, /CFBundleShortVersionString/);
  assert.match(source, /codesign --force --deep --sign -/);
  assert.match(source, /codesign --verify --deep --strict/);
});

test("Electron selects macOS update ZIPs and starts the shell updater", async () => {
  const source = await readFile(path.join(root, "electron", "main.mjs"), "utf8");
  assert.ok(source.includes("-mac-${arch}\\\\.zip"));
  assert.match(source, /electron", "updater\.sh/);
  assert.match(source, /spawn\("\/bin\/sh"/);
  assert.match(source, /macInstallPath/);
  assert.match(source, /path\.resolve\(app\.getAppPath\(\), "\.\.", "\.\.", "\.\."\)/);
  assert.match(source, /cleanupUpdateArtifacts/);
  assert.match(source, /stale-update-archive/);
  assert.match(source, /canApplyMacPatch/);
  assert.match(source, /canApplyPatch/);
  assert.match(source, /selectMacUpdatePackage/);
  assert.match(source, /scriptArguments\.push\("--patch", "--expected-version", downloadedUpdate\.version\)/);
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
