import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
if (process.platform !== "darwin") throw new Error("macOS版はmacOSまたはGitHub Actions上で作成してください。");
const arch = process.arch === "arm64" ? "arm64" : "x64";
const releaseRoot = path.join(root, "release-electron-mac");
const stage = path.join(releaseRoot, "stage");
const appBundle = path.join(stage, "WebRevisionDesk.app");
const application = path.join(appBundle, "Contents", "Resources", "app");
const zipPath = path.join(releaseRoot, `WebRevisionDesk-${packageJson.version}-mac-${arch}.zip`);
const dmgRoot = path.join(releaseRoot, "dmg-root");
const dmgPath = path.join(releaseRoot, `WebRevisionDesk-${packageJson.version}-mac-${arch}.dmg`);
const electronApp = path.join(root, "node_modules", "electron", "dist", "Electron.app");

try {
  await access(electronApp);
} catch {
  // Some hosted Apple Silicon runners complete npm ci before Electron's binary
  // postinstall has populated dist. Retry the official downloader explicitly.
  await run(process.execPath, [path.join(root, "node_modules", "electron", "install.js")], { cwd: root });
}

await rm(releaseRoot, { recursive: true, force: true });
// `ditto` preserves the relative framework symlinks in Electron.app. Node's
// `cp` rewrites them as absolute paths to the build workspace, which makes the
// distributed application unloadable on another Mac.
await run("ditto", [electronApp, appBundle]);
await mkdir(path.join(application, "src"), { recursive: true });
await Promise.all([
  cp(path.join(root, "electron"), path.join(application, "electron"), { recursive: true }),
  cp(path.join(root, "dist"), path.join(application, "dist"), { recursive: true }),
  cp(path.join(root, "src", "electron-feasibility-core.js"), path.join(application, "src", "electron-feasibility-core.js")),
  cp(path.join(root, "src", "browser-task-queue.js"), path.join(application, "src", "browser-task-queue.js")),
  cp(path.join(root, "LICENSE"), path.join(application, "LICENSE")),
  cp(path.join(root, "THIRD_PARTY_NOTICES.md"), path.join(application, "THIRD_PARTY_NOTICES.md")),
  writeFile(path.join(application, "package.json"), `${JSON.stringify({ name: packageJson.name, version: packageJson.version, type: "module", main: "electron/main.mjs" }, null, 2)}\n`),
]);
const plist = path.join(appBundle, "Contents", "Info.plist");
await run("/usr/libexec/PlistBuddy", ["-c", "Set :CFBundleDisplayName WebRevisionDesk", plist]);
await run("/usr/libexec/PlistBuddy", ["-c", "Set :CFBundleName WebRevisionDesk", plist]);
await run("/usr/libexec/PlistBuddy", ["-c", "Set :CFBundleIdentifier jp.co.webrevisiondesk.app", plist]);
await run("/usr/libexec/PlistBuddy", ["-c", `Set :CFBundleShortVersionString ${packageJson.version}`, plist]);
await run("/usr/libexec/PlistBuddy", ["-c", `Set :CFBundleVersion ${packageJson.version}`, plist]);
// Resource changes invalidate Electron's bundled signature. An ad-hoc signature
// keeps the unsigned distribution runnable without an Apple Developer account.
await run("codesign", ["--force", "--deep", "--sign", "-", appBundle]);
await run("codesign", ["--verify", "--deep", "--strict", appBundle]);
await run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", appBundle, zipPath]);
await mkdir(dmgRoot, { recursive: true });
await run("ditto", [appBundle, path.join(dmgRoot, "WebRevisionDesk.app")]);
await run("ln", ["-s", "/Applications", path.join(dmgRoot, "Applications")]);
await run("hdiutil", ["create", "-volname", "Web Revision Desk", "-srcfolder", dmgRoot, "-ov", "-format", "UDZO", dmgPath]);
const lines = await Promise.all([zipPath, dmgPath].map(async (file) => `${createHash("sha256").update(await readFile(file)).digest("hex")}  ${path.basename(file)}`));
await writeFile(path.join(releaseRoot, "SHA256SUMS.txt"), `${lines.join("\n")}\n`, "ascii");
console.log(`Created ${zipPath}\nCreated ${dmgPath}`);
