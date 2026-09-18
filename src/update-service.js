import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const APP_DIRECTORY = "WebRevisionEditor";
const SETTINGS_VERSION = 1;
const MAX_UPDATE_SIZE = 1024 * 1024 * 1024;
const OFFICIAL_REPOSITORY = "https://github.com/MZ-Gen-Labs/WebRevisionDesk";

function defaultDataDirectory() {
  if (process.env.WEB_REVISION_DATA_DIR) return path.resolve(process.env.WEB_REVISION_DATA_DIR);
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA || process.env.APPDATA || os.homedir(), APP_DIRECTORY);
  }
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", APP_DIRECTORY);
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), APP_DIRECTORY);
}

export function parseRepository(value) {
  const input = String(value || "").trim().replace(/\.git$/i, "").replace(/\/$/, "");
  if (!input) return null;
  const match = input.match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/i);
  if (!match) throw new Error("GitHubリポジトリは https://github.com/所有者/リポジトリ の形式で入力してください。");
  return { owner: match[1], repo: match[2], url: `https://github.com/${match[1]}/${match[2]}` };
}

export function normalizedVersion(value) {
  return String(value || "0.0.0").trim().replace(/^v/i, "");
}

export function compareVersions(left, right) {
  const parts = (value) => {
    const result = normalizedVersion(value).split(/[.-]/).slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
    while (result.length < 3) result.push(0);
    return result;
  };
  const a = parts(left);
  const b = parts(right);
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

export function releaseAsset(release) {
  const candidates = (release.assets || []).filter((asset) => /[-_]win[-_]x64\.zip$/i.test(asset.name));
  const updates = candidates.filter((asset) => !/(?:complete|full)/i.test(asset.name));
  return updates.find((asset) => /win(?:dows)?[-_]?x64/i.test(asset.name))
    || updates.find((asset) => /win(?:dows)?/i.test(asset.name))
    || null;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "WebRevisionDesk",
      "X-GitHub-Api-Version": "2022-11-28",
      ...options.headers,
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error("公開済みのGitHub Releaseが見つかりません。");
    if (response.status === 403 || response.status === 429) throw new Error("GitHubの確認回数上限に達しました。しばらくしてから再確認してください。");
    throw new Error(`GitHubの更新確認に失敗しました（HTTP ${response.status}）。`);
  }
  return response.json();
}

async function fetchManifest(release) {
  const asset = (release.assets || []).find((item) => item.name === "update.json");
  if (!asset) return {};
  try {
    const response = await fetch(asset.browser_download_url, {
      headers: { "User-Agent": "WebRevisionDesk" },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return {};
    return await response.json();
  } catch {
    return {};
  }
}

export async function createUpdateService({ appVersion, legacyProfileDirectory, installRoot = process.env.WEB_REVISION_INSTALL_ROOT }) {
  const dataDirectory = defaultDataDirectory();
  const profileDirectory = path.join(dataDirectory, "capture-profile");
  const updatesDirectory = path.join(dataDirectory, "updates");
  const settingsFile = path.join(dataDirectory, "settings.json");
  await Promise.all([
    mkdir(profileDirectory, { recursive: true }),
    mkdir(updatesDirectory, { recursive: true }),
  ]);

  // 既存PoCのログイン状態は、移行先が空の場合だけ引き継ぐ。
  if (legacyProfileDirectory) {
    try {
      const targetEntries = await import("node:fs/promises").then(({ readdir }) => readdir(profileDirectory));
      if (!targetEntries.length) {
        await access(legacyProfileDirectory);
        const { cp } = await import("node:fs/promises");
        await cp(legacyProfileDirectory, profileDirectory, { recursive: true, force: false });
      }
    } catch {
      // 旧プロファイルがない場合や移行不能でも、新しい保存先で継続する。
    }
  }

  async function readSettings() {
    const defaults = {
      version: SETTINGS_VERSION,
      githubRepository: OFFICIAL_REPOSITORY,
      checkUpdatesOnStartup: true,
      lastCheckAttemptAt: null,
      lastCheckAt: null,
      lastDownloadedVersion: null,
      lastDownloadedUpdate: null,
    };
    try {
      const saved = JSON.parse(await readFile(settingsFile, "utf8"));
      return {
        ...defaults,
        ...saved,
        githubRepository: saved.githubRepository || OFFICIAL_REPOSITORY,
        version: SETTINGS_VERSION,
      };
    } catch (error) {
      if (error.code !== "ENOENT") console.warn("Settings could not be read:", error.message);
      return defaults;
    }
  }

  async function saveSettings(patch) {
    const current = await readSettings();
    const next = {
      ...current,
      ...patch,
      githubRepository: parseRepository(patch.githubRepository)?.url || "",
      checkUpdatesOnStartup: patch.checkUpdatesOnStartup !== false,
      version: SETTINGS_VERSION,
    };
    const temporary = `${settingsFile}.tmp`;
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, settingsFile);
    return next;
  }

  async function check() {
    const settings = await readSettings();
    const repository = parseRepository(settings.githubRepository);
    if (!repository) throw new Error("設定画面でGitHubリポジトリを登録してください。");
    const attemptedAt = new Date().toISOString();
    await saveSettings({ ...settings, lastCheckAttemptAt: attemptedAt });
    const release = await fetchJson(`https://api.github.com/repos/${repository.owner}/${repository.repo}/releases/latest`);
    const manifest = await fetchManifest(release);
    const asset = releaseAsset(release);
    const latestVersion = normalizedVersion(release.tag_name);
    const result = {
      currentVersion: appVersion,
      latestVersion,
      updateAvailable: compareVersions(latestVersion, appVersion) > 0,
      updateType: ["normal", "security"].includes(manifest.updateType) ? manifest.updateType : "normal",
      severity: ["low", "moderate", "high", "critical"].includes(manifest.severity) ? manifest.severity : null,
      mandatory: manifest.mandatory === true,
      minimumSupportedVersion: manifest.minimumSupportedVersion || null,
      name: release.name || release.tag_name,
      notes: String(manifest.notes || release.body || "").slice(0, 4000),
      publishedAt: release.published_at,
      releaseUrl: release.html_url,
      downloadable: Boolean(asset),
      asset: asset ? { name: asset.name, size: asset.size, digest: asset.digest || null } : null,
    };
    await saveSettings({ ...settings, lastCheckAttemptAt: attemptedAt, lastCheckAt: new Date().toISOString() });
    return result;
  }

  async function download() {
    const settings = await readSettings();
    const repository = parseRepository(settings.githubRepository);
    if (!repository) throw new Error("設定画面でGitHubリポジトリを登録してください。");
    const release = await fetchJson(`https://api.github.com/repos/${repository.owner}/${repository.repo}/releases/latest`);
    const asset = releaseAsset(release);
    if (!asset) throw new Error("ReleaseにWindows用ZIPが添付されていません。");
    if (asset.size > MAX_UPDATE_SIZE) throw new Error("更新ZIPが許容サイズを超えています。");
    const version = normalizedVersion(release.tag_name);
    if (!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(version)) throw new Error("更新バージョンが不正です。");
    if (!/^sha256:[a-f0-9]{64}$/i.test(asset.digest || "")) throw new Error("更新ZIPのSHA-256検証情報がありません。適用しません。");
    if (compareVersions(version, appVersion) <= 0) throw new Error("ダウンロードが必要な新しいバージョンはありません。");
    const versionDirectory = path.join(updatesDirectory, version);
    await mkdir(versionDirectory, { recursive: true });
    const fileName = path.basename(asset.name).replace(/[^A-Za-z0-9._-]/g, "-");
    const destination = path.join(versionDirectory, fileName);
    const temporary = `${destination}.part`;
    const response = await fetch(asset.browser_download_url, {
      headers: { "User-Agent": "WebRevisionDesk" },
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });
    if (!response.ok || !response.body) throw new Error(`更新ZIPをダウンロードできませんでした（HTTP ${response.status}）。`);
    const hash = createHash("sha256");
    const output = createWriteStream(temporary, { flags: "w", mode: 0o600 });
    let size = 0;
    try {
      await pipeline(response.body, new Transform({
        transform(chunk, encoding, callback) {
          size += chunk.length;
          if (size > MAX_UPDATE_SIZE) return callback(new Error("更新ZIPが許容サイズを超えています。"));
          hash.update(chunk);
          callback(null, chunk);
        },
      }), output);
    } catch (error) {
      output.destroy();
      await unlink(temporary).catch(() => {});
      throw error;
    }
    const digest = `sha256:${hash.digest("hex")}`;
    if (asset.digest && asset.digest.toLowerCase() !== digest.toLowerCase()) {
      await unlink(temporary).catch(() => {});
      throw new Error("更新ZIPのSHA-256がGitHubの値と一致しません。ファイルは適用しません。");
    }
    await unlink(destination).catch(() => {});
    await rename(temporary, destination);
    const downloadedUpdate = { version, fileName, size, digest, path: destination, downloadedAt: new Date().toISOString() };
    await saveSettings({ ...settings, lastDownloadedVersion: version, lastDownloadedUpdate: downloadedUpdate });
    return downloadedUpdate;
  }

  async function canApply() {
    if (process.platform !== "win32" || !installRoot) return false;
    try {
      await access(path.join(path.resolve(installRoot), "updater.ps1"));
      return true;
    } catch {
      return false;
    }
  }

  async function apply() {
    if (!(await canApply())) throw new Error("自動切り替えはWindowsポータブル版から起動した場合に利用できます。");
    const settings = await readSettings();
    const update = settings.lastDownloadedUpdate;
    if (!update?.path || compareVersions(update.version, appVersion) <= 0) {
      throw new Error("適用できるダウンロード済み更新版がありません。");
    }
    await access(update.path);
    const updater = path.join(path.resolve(installRoot), "updater.ps1");
    const child = spawn("powershell.exe", [
      "-NoProfile", "-File", updater,
      "-InstallRoot", path.resolve(installRoot),
      "-Version", update.version,
      "-ZipPath", update.path,
      "-ExpectedDigest", update.digest,
      "-AppPid", String(process.pid),
    ], { detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
    return { applying: true, version: update.version };
  }

  return {
    appVersion,
    dataDirectory,
    profileDirectory,
    readSettings,
    saveSettings,
    check,
    download,
    canApply,
    apply,
  };
}
