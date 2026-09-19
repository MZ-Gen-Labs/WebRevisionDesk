import { execFile } from "node:child_process";
import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const electronPackage = JSON.parse(await readFile(path.join(root, "node_modules", "electron", "package.json"), "utf8"));

if (process.platform !== "win32") throw new Error("Electron移行版ZIPはWindowsまたはGitHub Actions上で作成してください。");

const releaseRoot = path.join(root, "release-electron-migration");
const directoryName = `WebRevisionDesk-${packageJson.version}-electron-migration-win-x64`;
const stage = path.join(releaseRoot, directoryName);
const application = path.join(stage, "resources", "app");
const zipPath = path.join(releaseRoot, `${directoryName}.zip`);
const electronDistribution = path.join(root, "node_modules", "electron", "dist");

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
  cp(path.join(root, "LICENSE"), path.join(application, "LICENSE")),
  cp(path.join(root, "THIRD_PARTY_NOTICES.md"), path.join(application, "THIRD_PARTY_NOTICES.md")),
  writeFile(path.join(application, "package.json"), `${JSON.stringify({
    name: packageJson.name,
    version: packageJson.version,
    description: `${packageJson.description} Electron migration build`,
    license: packageJson.license,
    type: "module",
    main: "electron/main.mjs",
  }, null, 2)}\n`, "utf8"),
  writeFile(path.join(stage, "Start-WebRevisionDesk-Electron.cmd"), "@echo off\r\nstart \"\" \"%~dp0WebRevisionDesk-Electron.exe\"\r\n", "ascii"),
  writeFile(path.join(stage, "README-FIRST.txt"), [
    "Web Revision Desk - Electron Migration Build",
    "",
    "1. Extract this ZIP to a local folder.",
    "2. Double-click Start-WebRevisionDesk-Electron.cmd.",
    "3. Select a project folder, discover pages, preview, capture, edit, and save.",
    "",
    `App version: ${packageJson.version}`,
    `Electron version: ${electronPackage.version}`,
    "This migration build does not replace the stable application yet.",
    "",
  ].join("\r\n"), "ascii"),
]);
await rename(path.join(stage, "electron.exe"), path.join(stage, "WebRevisionDesk-Electron.exe"));

const quotePowerShell = (value) => `'${String(value).replaceAll("'", "''")}'`;
await run("powershell.exe", [
  "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
  `Compress-Archive -Path (Join-Path ${quotePowerShell(stage)} '*') -DestinationPath ${quotePowerShell(zipPath)} -CompressionLevel Optimal -Force`,
], { cwd: root });

console.log(`Created ${zipPath}`);
