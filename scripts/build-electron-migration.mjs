import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const electronPackage = JSON.parse(await readFile(path.join(root, "node_modules", "electron", "package.json"), "utf8"));

if (process.platform !== "win32") throw new Error("Electron版ZIPはWindowsまたはGitHub Actions上で作成してください。");

const formalRelease = process.env.WEB_REVISION_ELECTRON_RELEASE === "1";
const releaseRoot = path.join(root, formalRelease ? "release-electron" : "release-electron-migration");
const directoryName = formalRelease
  ? `WebRevisionDesk-${packageJson.version}-electron-win-x64`
  : `WebRevisionDesk-${packageJson.version}-electron-migration-win-x64`;
// The archive filename remains versioned, while its contents use this stable
// directory name so extracted installations and their shortcuts keep a fixed path.
const stage = path.join(releaseRoot, "WebRevisionDesk");
const application = path.join(stage, "resources", "app");
const zipPath = path.join(releaseRoot, `${directoryName}.zip`);
const electronDistribution = path.join(root, "node_modules", "electron", "dist");
const executableName = formalRelease ? "WebRevisionDesk.exe" : "WebRevisionDesk-Electron.exe";
const launcherName = formalRelease ? "Start-WebRevisionDesk.cmd" : "Start-WebRevisionDesk-Electron.cmd";

await run(process.execPath, [path.join(root, "node_modules", "electron", "cli.js"), "--version"], { cwd: root });
await rm(releaseRoot, { recursive: true, force: true });
await mkdir(path.join(application, "src"), { recursive: true });
await cp(electronDistribution, stage, { recursive: true });
await rm(path.join(stage, "resources", "default_app.asar"), { force: true });
await Promise.all([
  cp(path.join(root, "electron"), path.join(application, "electron"), { recursive: true }),
  cp(path.join(root, "dist"), path.join(application, "dist"), { recursive: true }),
  cp(path.join(root, "src", "electron-feasibility-core.js"), path.join(application, "src", "electron-feasibility-core.js")),
  cp(path.join(root, "src", "browser-task-queue.js"), path.join(application, "src", "browser-task-queue.js")),
  cp(path.join(root, "src", "tracking-resource-filter.js"), path.join(application, "src", "tracking-resource-filter.js")),
  cp(path.join(root, "LICENSE"), path.join(application, "LICENSE")),
  cp(path.join(root, "THIRD_PARTY_NOTICES.md"), path.join(application, "THIRD_PARTY_NOTICES.md")),
  writeFile(path.join(application, "package.json"), `${JSON.stringify({
    name: packageJson.name,
    version: packageJson.version,
    description: `${packageJson.description} Electron build`,
    license: packageJson.license,
    type: "module",
    main: "electron/main.mjs",
  }, null, 2)}\n`, "utf8"),
  writeFile(path.join(stage, launcherName), `@echo off\r\nstart \"\" \"%~dp0${executableName}\"\r\n`, "ascii"),
  writeFile(path.join(stage, "README-FIRST.txt"), [
    formalRelease ? "Web Revision Desk - Electron Edition" : "Web Revision Desk - Electron Migration Build",
    "",
    "1. Extract this ZIP to a local folder.",
    `2. Double-click ${launcherName}.`,
    "3. Select a project folder, discover pages, preview, capture, edit, and save.",
    "",
    `App version: ${packageJson.version}`,
    `Electron version: ${electronPackage.version}`,
    formalRelease ? "This is the stable Electron edition." : "This migration build does not replace the stable application yet.",
    "",
  ].join("\r\n"), "ascii"),
]);
await rename(path.join(stage, "electron.exe"), path.join(stage, executableName));

const quotePowerShell = (value) => `'${String(value).replaceAll("'", "''")}'`;
await run("powershell.exe", [
  "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
  `Compress-Archive -Path ${quotePowerShell(stage)} -DestinationPath ${quotePowerShell(zipPath)} -CompressionLevel Optimal -Force`,
], { cwd: root });

const digest = createHash("sha256").update(await readFile(zipPath)).digest("hex");
await writeFile(path.join(releaseRoot, "SHA256SUMS.txt"), `${digest}  ${path.basename(zipPath)}\n`, "ascii");
await writeFile(path.join(releaseRoot, "release.json"), `${JSON.stringify({
  version: packageJson.version,
  channel: "stable",
  asset: path.basename(zipPath),
  sha256: digest,
  publishedAt: new Date().toISOString(),
}, null, 2)}\n`, "utf8");

console.log(`Created ${zipPath}\nSHA-256 ${digest}`);
