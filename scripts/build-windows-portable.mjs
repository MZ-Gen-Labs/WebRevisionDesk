import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const version = packageJson.version;
const nodeVersion = (process.env.WEB_REVISION_NODE_VERSION || packageJson.portable?.nodeVersion || process.version).replace(/^v/, "");
const outputRoot = path.join(root, "release");
const workRoot = path.join(outputRoot, ".build");
const appDirectory = path.join(workRoot, "app");
const completeDirectory = path.join(workRoot, "complete", "WebRevisionDesk");

if (process.platform !== "win32") {
  throw new Error("Windowsポータブル版はWindows 11またはWindowsのCI環境で作成してください。");
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const shell = process.platform === "win32" && command.toLowerCase().endsWith(".cmd");
    const child = spawn(command, args, { cwd: root, stdio: "inherit", shell, ...options });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} が終了コード ${code} で失敗しました。`)));
  });
}

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function download(url, destination) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10 * 60 * 1000) });
  if (!response.ok || !response.body) throw new Error(`${url} のダウンロードに失敗しました。`);
  const chunks = [];
  for await (const chunk of response.body) chunks.push(chunk);
  await writeFile(destination, Buffer.concat(chunks));
}

function powerShellLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

await rm(workRoot, { recursive: true, force: true });
await mkdir(appDirectory, { recursive: true });
await mkdir(path.join(appDirectory, "src"), { recursive: true });
await mkdir(outputRoot, { recursive: true });
await run("npm.cmd", ["run", "build"]);

await Promise.all([
  cp(path.join(root, "dist"), path.join(appDirectory, "dist"), { recursive: true }),
  cp(path.join(root, "server.js"), path.join(appDirectory, "server.js")),
  cp(path.join(root, "src", "browser-task-queue.js"), path.join(appDirectory, "src", "browser-task-queue.js")),
  cp(path.join(root, "src", "capture-page.js"), path.join(appDirectory, "src", "capture-page.js")),
  cp(path.join(root, "src", "update-service.js"), path.join(appDirectory, "src", "update-service.js")),
  cp(path.join(root, "README.md"), path.join(appDirectory, "README.md")),
  cp(path.join(root, "THIRD_PARTY_NOTICES.md"), path.join(appDirectory, "THIRD_PARTY_NOTICES.md")),
  cp(path.join(root, "package.json"), path.join(appDirectory, "package.json")),
  cp(path.join(root, "package-lock.json"), path.join(appDirectory, "package-lock.json")),
]);
await run("npm.cmd", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
  cwd: appDirectory,
  env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1" },
});
await run(path.join(appDirectory, "node_modules", ".bin", "playwright.cmd"), ["install", "chromium"], {
  cwd: appDirectory,
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: "0" },
});

const nodeArchiveName = `node-v${nodeVersion}-win-x64.zip`;
const nodeArchive = path.join(workRoot, nodeArchiveName);
const nodeBaseUrl = `https://nodejs.org/dist/v${nodeVersion}`;
await download(`${nodeBaseUrl}/${nodeArchiveName}`, nodeArchive);
const checksums = await fetch(`${nodeBaseUrl}/SHASUMS256.txt`, { signal: AbortSignal.timeout(30000) }).then((response) => {
  if (!response.ok) throw new Error("Node.jsのチェックサムを取得できませんでした。");
  return response.text();
});
const expectedNodeHash = checksums.split(/\r?\n/).find((line) => line.endsWith(`  ${nodeArchiveName}`))?.split(/\s+/)[0];
if (!expectedNodeHash || await sha256(nodeArchive) !== expectedNodeHash) throw new Error("Node.js公式ZIPのSHA-256が一致しません。");
const nodeExtract = path.join(workRoot, "node-extract");
await run("powershell.exe", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath ${powerShellLiteral(nodeArchive)} -DestinationPath ${powerShellLiteral(nodeExtract)} -Force`]);
await cp(path.join(nodeExtract, `node-v${nodeVersion}-win-x64`), path.join(appDirectory, "node"), { recursive: true });

await writeFile(path.join(appDirectory, "release.json"), `${JSON.stringify({
  format: "web-revision-portable-release",
  version,
  nodeVersion,
  builtAt: new Date().toISOString(),
}, null, 2)}\n`);

const updateZip = path.join(outputRoot, `WebRevisionDesk-${version}-win-x64.zip`);
await rm(updateZip, { force: true });
await run("powershell.exe", ["-NoProfile", "-Command", `Compress-Archive -Path (Join-Path ${powerShellLiteral(appDirectory)} '*') -DestinationPath ${powerShellLiteral(updateZip)} -CompressionLevel Optimal`]);

await mkdir(path.join(completeDirectory, "versions", version), { recursive: true });
await cp(appDirectory, path.join(completeDirectory, "versions", version), { recursive: true });
for (const name of ["Start-WebRevisionDesk.cmd", "launcher.ps1", "updater.ps1"]) {
  await cp(path.join(root, "windows", name), path.join(completeDirectory, name));
}
await writeFile(path.join(completeDirectory, "current.json"), `${JSON.stringify({ version, previousVersion: null }, null, 2)}\n`);
const completeZip = path.join(outputRoot, `WebRevisionDesk-${version}-win-x64-complete.zip`);
await rm(completeZip, { force: true });
await run("powershell.exe", ["-NoProfile", "-Command", `Compress-Archive -Path ${powerShellLiteral(completeDirectory)} -DestinationPath ${powerShellLiteral(completeZip)} -CompressionLevel Optimal`]);

const sums = `${await sha256(updateZip)}  ${path.basename(updateZip)}\n${await sha256(completeZip)}  ${path.basename(completeZip)}\n`;
await writeFile(path.join(outputRoot, "SHA256SUMS.txt"), sums);
await writeFile(path.join(outputRoot, "update.json"), `${JSON.stringify({
  version,
  updateType: process.env.WEB_REVISION_UPDATE_TYPE || "normal",
  severity: process.env.WEB_REVISION_UPDATE_SEVERITY || null,
  mandatory: process.env.WEB_REVISION_UPDATE_MANDATORY === "true",
  minimumSupportedVersion: process.env.WEB_REVISION_MINIMUM_VERSION || null,
  notes: process.env.WEB_REVISION_UPDATE_NOTES || "",
}, null, 2)}\n`);
console.log(`Created:\n${updateZip}\n${completeZip}\n${path.join(outputRoot, "SHA256SUMS.txt")}`);
