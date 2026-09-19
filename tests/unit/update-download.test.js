import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { createUpdateService, pruneUpdateDownloads, updaterLauncherArguments, updaterPowerShellArguments } from "../../src/update-service.js";

test("only the newest downloaded update is retained", async () => {
  const updatesDirectory = await mkdtemp(path.join(os.tmpdir(), "web-revision-update-prune-test-"));
  const oldDirectory = path.join(updatesDirectory, "0.3.8");
  const latestDirectory = path.join(updatesDirectory, "0.4.0");
  await Promise.all([mkdir(oldDirectory), mkdir(latestDirectory)]);
  await Promise.all([
    writeFile(path.join(oldDirectory, "old.zip"), "old"),
    writeFile(path.join(latestDirectory, "latest.zip"), "latest"),
    writeFile(path.join(updatesDirectory, "abandoned.part"), "partial"),
  ]);

  try {
    await pruneUpdateDownloads(updatesDirectory, "0.4.0");
    await access(path.join(latestDirectory, "latest.zip"));
    await assert.rejects(access(oldDirectory), { code: "ENOENT" });
    await assert.rejects(access(path.join(updatesDirectory, "abandoned.part")), { code: "ENOENT" });
  } finally {
    await rm(updatesDirectory, { recursive: true, force: true });
  }
});

test("Windows updater is launched with the same execution-policy allowance as the main launcher", () => {
  const args = updaterPowerShellArguments({
    updater: "C:\\tool\\WebRevisionDesk\\updater.ps1",
    installRoot: "C:\\tool\\WebRevisionDesk",
    update: {
      version: "0.3.6",
      path: "C:\\Users\\tester\\update.zip",
      digest: `sha256:${"a".repeat(64)}`,
    },
    appPid: 1234,
  });
  assert.deepEqual(args.slice(0, 5), ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "C:\\tool\\WebRevisionDesk\\updater.ps1"]);
  assert.equal(args.at(-1), "1234");
});

test("Windows updater is detached through WMI without interpolating raw paths into the launcher command", () => {
  const args = updaterLauncherArguments({
    updater: "C:\\tool folder\\WebRevisionDesk\\updater.ps1",
    installRoot: "C:\\tool folder\\WebRevisionDesk",
    update: {
      version: "0.3.7",
      path: "C:\\Users\\test user's files\\update.zip",
      digest: `sha256:${"a".repeat(64)}`,
    },
    appPid: 1234,
    dataDirectory: "C:\\Users\\test user's files\\WebRevisionEditor",
  });
  assert.deepEqual(args.slice(0, 4), ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand"]);
  const launcherCommand = Buffer.from(args[4], "base64").toString("utf16le");
  assert.match(launcherCommand, /Invoke-CimMethod -ClassName Win32_Process -MethodName Create/);
  assert.match(launcherCommand, /powershell\.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -EncodedCommand/);
  assert.doesNotMatch(launcherCommand, /tool folder|user's files/);
  const updaterCommandEncoded = launcherCommand.match(/-EncodedCommand ([A-Za-z0-9+/=]+)'/)?.[1];
  assert.ok(updaterCommandEncoded);
  const updaterCommand = Buffer.from(updaterCommandEncoded, "base64").toString("utf16le");
  assert.match(updaterCommand, /Import-Module \(Join-Path \$PSHOME 'Modules\\Microsoft\.PowerShell\.Utility/);
  assert.match(updaterCommand, /C:\\tool folder\\WebRevisionDesk\\updater\.ps1/);
  assert.match(updaterCommand, /test user''s files/);
});

test("apply waits for the updater log before allowing the application to exit", async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "web-revision-apply-test-"));
  const installRoot = path.join(dataDirectory, "install");
  const archive = path.join(dataDirectory, "update.zip");
  const logDirectory = path.join(dataDirectory, "logs");
  const logFile = path.join(logDirectory, "updater.log");
  const previousDirectory = process.env.WEB_REVISION_DATA_DIR;
  process.env.WEB_REVISION_DATA_DIR = dataDirectory;
  await mkdir(installRoot, { recursive: true });
  await mkdir(logDirectory, { recursive: true });
  await writeFile(path.join(installRoot, "updater.ps1"), "# fixture\n");
  await writeFile(archive, "fixture");

  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.unrefCalled = false;
  child.unref = () => { child.unrefCalled = true; };
  child.kill = () => true;
  let spawnArguments;
  const spawnProcess = (command, args, options) => {
    spawnArguments = { command, args, options };
    queueMicrotask(() => child.emit("spawn"));
    return child;
  };

  try {
    const service = await createUpdateService({
      appVersion: "0.3.6",
      installRoot,
      platform: "win32",
      spawnProcess,
      updaterStartTimeoutMs: 1000,
    });
    await service.saveSettings({
      githubRepository: "https://github.com/MZ-Gen-Labs/WebRevisionDesk",
      checkUpdatesOnStartup: false,
      lastDownloadedUpdate: {
        version: "0.3.7",
        path: archive,
        digest: `sha256:${"a".repeat(64)}`,
      },
    });

    const applying = service.apply();
    await delay(100);
    assert.ok(spawnArguments);
    assert.equal(child.unrefCalled, false);
    const earlyResult = await Promise.race([applying.then(() => "resolved"), delay(100, "pending")]);
    assert.equal(earlyResult, "pending");

    await writeFile(logFile, `2026-09-19T00:00:00Z Waiting for PID ${process.pid} before applying v0.3.7.\n`);
    assert.deepEqual(await applying, { applying: true, version: "0.3.7" });
    assert.equal(child.unrefCalled, true);
    assert.equal(spawnArguments.command, "powershell.exe");
    assert.deepEqual(spawnArguments.args.slice(0, 4), ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand"]);
    assert.equal(spawnArguments.options.detached, false);
  } finally {
    if (previousDirectory === undefined) delete process.env.WEB_REVISION_DATA_DIR;
    else process.env.WEB_REVISION_DATA_DIR = previousDirectory;
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test("an update with a mismatched SHA-256 is rejected and not retained", async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "web-revision-update-test-"));
  const previousDirectory = process.env.WEB_REVISION_DATA_DIR;
  const previousFetch = globalThis.fetch;
  process.env.WEB_REVISION_DATA_DIR = dataDirectory;
  const archive = new TextEncoder().encode("not-the-declared-archive");
  const release = {
    tag_name: "v9.0.0",
    name: "Test release",
    body: "",
    published_at: "2026-09-18T00:00:00Z",
    html_url: "https://github.com/MZ-Gen-Labs/WebRevisionDesk/releases/tag/v9.0.0",
    assets: [{
      name: "WebRevisionDesk-9.0.0-win-x64.zip",
      size: archive.byteLength,
      digest: `sha256:${"0".repeat(64)}`,
      browser_download_url: "https://downloads.example/update.zip",
    }],
  };

  globalThis.fetch = async (url) => {
    if (String(url).includes("api.github.com")) {
      return new Response(JSON.stringify(release), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(archive, { status: 200 });
  };

  try {
    const service = await createUpdateService({ appVersion: "1.0.0" });
    await assert.rejects(() => service.download(), /SHA-256/);
    const settings = await service.readSettings();
    assert.equal(settings.lastDownloadedUpdate, null);
    release.assets[0].digest = null;
    await assert.rejects(() => service.download(), /SHA-256検証情報/);
    release.assets[0].digest = `sha256:${"0".repeat(64)}`;
    release.tag_name = "v9.0.0/../../outside";
    await assert.rejects(() => service.download(), /バージョンが不正/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousDirectory === undefined) delete process.env.WEB_REVISION_DATA_DIR;
    else process.env.WEB_REVISION_DATA_DIR = previousDirectory;
    await rm(dataDirectory, { recursive: true, force: true });
  }
});
