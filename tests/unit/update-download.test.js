import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createUpdateService, updaterPowerShellArguments } from "../../src/update-service.js";

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
