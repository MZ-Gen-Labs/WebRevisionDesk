import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
if (process.platform !== "win32") throw new Error("Windows用Setup.exeはWindowsまたはGitHub Actions上で作成してください。");
await stat(path.join(root, "release-electron", "WebRevisionDesk", "WebRevisionDesk.exe"));
const iscc = process.env.INNO_SETUP_COMPILER || "ISCC.exe";
await run(iscc, [path.join(root, "installer", "WebRevisionDesk.iss")], {
  cwd: root,
  env: { ...process.env, WEB_REVISION_DESK_VERSION: packageJson.version },
});
console.log(`Created release-electron/WebRevisionDesk-${packageJson.version}-Setup.exe`);
