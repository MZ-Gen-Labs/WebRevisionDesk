import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { addReleaseChecksum } from "./release-checksums.mjs";

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const electronPackage = JSON.parse(await readFile(path.join(root, "node_modules", "electron", "package.json"), "utf8"));
const baseline = JSON.parse(await readFile(path.join(root, "installer", "windows-patch-baseline.json"), "utf8"));
if (process.platform !== "win32") throw new Error("Windows用差分Setup.exeはWindowsまたはGitHub Actions上で作成してください。");
if (packageJson.version.localeCompare(baseline.minimumAppVersion, undefined, { numeric: true }) <= 0) {
  throw new Error(`Current version ${packageJson.version} must be newer than patch baseline ${baseline.minimumAppVersion}.`);
}
if (electronPackage.version !== baseline.electronVersion) {
  throw new Error(`Electron ${electronPackage.version} differs from patch baseline ${baseline.electronVersion}; review installer/windows-patch-baseline.json before publishing.`);
}

const releaseRoot = path.join(root, "release-electron");
const appRoot = path.join(releaseRoot, "WebRevisionDesk");
await stat(path.join(appRoot, "WebRevisionDesk.exe"));
const appPackage = JSON.parse(await readFile(path.join(appRoot, "resources", "app", "package.json"), "utf8"));
if (appPackage.version !== packageJson.version) {
  throw new Error(`Packaged app version ${appPackage.version} does not match release version ${packageJson.version}.`);
}
await stat(path.join(appRoot, "resources", "app", "electron", "main.mjs"));

const iscc = process.env.INNO_SETUP_COMPILER || "ISCC.exe";
await run(iscc, [path.join(root, "installer", "WebRevisionDesk-Patch.iss")], {
  cwd: root,
  env: {
    ...process.env,
    WEB_REVISION_DESK_VERSION: packageJson.version,
    WEB_REVISION_DESK_MINIMUM_PATCH_VERSION: baseline.minimumAppVersion,
  },
});
const installerPath = path.join(releaseRoot, `WebRevisionDesk-${packageJson.version}-Patch-from-${baseline.minimumAppVersion}+-Setup.exe`);
const installerSize = (await stat(installerPath)).size;
if (installerSize > 10 * 1024 * 1024) {
  throw new Error(`Patch installer exceeds the 10 MiB release limit (${installerSize} bytes).`);
}
const digest = await addReleaseChecksum(releaseRoot, installerPath);
console.log(`Created ${installerPath}\nSize ${installerSize} bytes\nSHA-256 ${digest}`);
