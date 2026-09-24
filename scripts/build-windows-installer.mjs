import { execFile } from "node:child_process";
import { addReleaseChecksum } from "./release-checksums.mjs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
if (process.platform !== "win32") throw new Error("Windows用Setup.exeはWindowsまたはGitHub Actions上で作成してください。");
const releaseRoot = path.join(root, "release-electron");
await stat(path.join(releaseRoot, "WebRevisionDesk", "WebRevisionDesk.exe"));
const iscc = process.env.INNO_SETUP_COMPILER || "ISCC.exe";
await run(iscc, [path.join(root, "installer", "WebRevisionDesk.iss")], {
  cwd: root,
  env: { ...process.env, WEB_REVISION_DESK_VERSION: packageJson.version },
});
const installerPath = path.join(releaseRoot, `WebRevisionDesk-${packageJson.version}-Setup.exe`);
await addReleaseChecksum(releaseRoot, installerPath);
console.log(`Created ${installerPath}`);
