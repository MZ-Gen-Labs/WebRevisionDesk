import { app, BrowserWindow, dialog, ipcMain, net, protocol, session } from "electron";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile, stat, rm } from "node:fs/promises";
import path from "node:path";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BrowserTaskQueue } from "../src/browser-task-queue.js";
import { removeProjectEntry } from "./project-file-system.mjs";
import {
  isCrawlTarget,
  normalizeHttpUrl,
  redactUrl,
  safeArtifactBaseName,
} from "../src/electron-feasibility-core.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(currentDirectory, "..");
const feasibilityUiDirectory = path.join(currentDirectory, "ui");
const editorUiDirectory = path.join(rootDirectory, "dist");
const packageJson = JSON.parse(await readFile(path.join(rootDirectory, "package.json"), "utf8"));
const feasibilityMode = process.argv.includes("--feasibility-ui") || process.argv.includes("--feasibility-smoke-test");
const uiDirectory = feasibilityMode ? feasibilityUiDirectory : editorUiDirectory;
const CAPTURE_PARTITION = "persist:web-revision-desk";
const MAX_RESOURCE_BYTES = 15 * 1024 * 1024;
const MAX_TOTAL_BYTES = 60 * 1024 * 1024;
const navigationTimeoutMs = 45_000;
const browserTaskQueue = new BrowserTaskQueue();

let mainWindow;
let pageWindow;
let captureSession;
let lastInspection;
let lastCapture;
let lastCrawl;
let activeCaptureSessionId = "";
let projectDirectory = "";
let shuttingDown = false;
let allowMainWindowClose = false;
let mainWindowClosePending = false;
let downloadedUpdate = null;
const backgroundWindows = new Set();
const diagnosticEvents = [];

protocol.registerSchemesAsPrivileged([{
  scheme: "wrd",
  privileges: { standard: true, secure: true, supportFetchAPI: true },
}]);
app.setName("WebRevisionDesk");
app.setPath("userData", path.join(app.getPath("appData"), "WebRevisionDesk"));

function progress(message, detail = {}) {
  mainWindow?.webContents.send("feasibility:progress", { message, ...detail });
}

async function record(type, detail = {}) {
  const event = { at: new Date().toISOString(), type, ...detail };
  diagnosticEvents.push(event);
  if (diagnosticEvents.length > 300) diagnosticEvents.shift();
  try {
    const logDirectory = path.join(app.getPath("userData"), "logs");
    await mkdir(logDirectory, { recursive: true });
    await appendFile(path.join(logDirectory, "electron-feasibility.log"), `${JSON.stringify(event)}\n`, "utf8");
  } catch {}
}

function assertTrustedSender(event) {
  try {
    const sender = new URL(event.senderFrame?.url || "");
    if (sender.protocol === "wrd:" && sender.host === "app") return;
  } catch {}
  throw new Error("許可されていない画面からの操作です。");
}

function toScriptValue(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function extractCssUrls(css, baseUrl) {
  const urls = new Set();
  for (const match of String(css).matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gim)) {
    const value = match[2]?.trim();
    if (!value || /^(data:|blob:|#)/i.test(value)) continue;
    try { urls.add(new URL(value, baseUrl).href); } catch {}
  }
  return urls;
}

function rewriteCss(css, baseUrl, assets) {
  return String(css).replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gim, (whole, _quote, value) => {
    if (!value || /^(data:|blob:|#)/i.test(value.trim())) return whole;
    try {
      const absolute = new URL(value.trim(), baseUrl).href;
      return assets.has(absolute) ? `url("${assets.get(absolute)}")` : whole;
    } catch {
      return whole;
    }
  });
}

function inlineCssImports(css, baseUrl, cssSources, seen = new Set()) {
  return String(css).replace(/@import\s*(?:url\(\s*)?(['"]?)([^'"\s)]+)\1\s*\)?\s*([^;]*);/gim, (whole, _quote, value, mediaQuery) => {
    let importedUrl;
    try { importedUrl = new URL(value, baseUrl).href; } catch { return whole; }
    if (seen.has(importedUrl) || !cssSources.has(importedUrl)) return whole;
    const imported = inlineCssImports(cssSources.get(importedUrl), importedUrl, cssSources, new Set(seen).add(importedUrl));
    return mediaQuery.trim() ? `@media ${mediaQuery.trim()} {\n${imported}\n}` : imported;
  });
}

async function withNavigationTimeout(contents, url) {
  let timer;
  try {
    await Promise.race([
      contents.loadURL(url),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          contents.stop();
          reject(new Error(`ページ表示が${navigationTimeoutMs / 1000}秒以内に完了しませんでした。`));
        }, navigationTimeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function secureWebPreferences() {
  return {
    partition: CAPTURE_PARTITION,
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
  };
}

function attachRemoteGuards(contents) {
  contents.setWindowOpenHandler(({ url }) => {
    if (!/^https?:/i.test(url)) return { action: "deny" };
    record("popup-request", { url: redactUrl(url) });
    return {
      action: "allow",
      overrideBrowserWindowOptions: { webPreferences: secureWebPreferences() },
    };
  });
  contents.on("did-create-window", (window) => attachRemoteGuards(window.webContents));
  contents.on("will-navigate", (_event, url) => record("navigation", { url: redactUrl(url) }));
  contents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
    if (isMainFrame) record("load-failed", { code, description, url: redactUrl(url) });
  });
  contents.on("render-process-gone", (_event, detail) => record("renderer-gone", detail));
}

function ensurePageWindow() {
  if (pageWindow && !pageWindow.isDestroyed()) return pageWindow;
  pageWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    show: false,
    title: "Web Revision Desk - Electron取得検証",
    webPreferences: secureWebPreferences(),
  });
  attachRemoteGuards(pageWindow.webContents);
  pageWindow.on("closed", () => { pageWindow = undefined; });
  return pageWindow;
}

function closePageWindow() {
  if (pageWindow && !pageWindow.isDestroyed()) pageWindow.destroy();
  pageWindow = undefined;
  activeCaptureSessionId = "";
}

function closeAuxiliaryWindows() {
  closePageWindow();
  for (const window of backgroundWindows) {
    if (!window.isDestroyed()) window.destroy();
  }
  backgroundWindows.clear();
}

function createBackgroundPageWindow(title) {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    title,
    webPreferences: secureWebPreferences(),
  });
  backgroundWindows.add(window);
  window.on("closed", () => backgroundWindows.delete(window));
  attachRemoteGuards(window.webContents);
  return window;
}

async function executeInPage(contents, code) {
  return contents.executeJavaScriptInIsolatedWorld(1001, [{ code }], false);
}

const inspectionScript = `(() => {
  const absolute = (value) => { try { return new URL(value, document.baseURI).href; } catch { return ""; } };
  const links = [...new Set([...document.querySelectorAll("a[href]")].map((a) => absolute(a.getAttribute("href"))).filter((url) => /^https?:/i.test(url)))];
  const resources = new Set(performance.getEntriesByType("resource").map((entry) => entry.name));
  document.querySelectorAll("img").forEach((image) => resources.add(image.currentSrc || absolute(image.getAttribute("src"))));
  document.querySelectorAll("link[rel~='stylesheet'][href]").forEach((link) => resources.add(absolute(link.getAttribute("href"))));
  document.querySelectorAll("[poster]").forEach((element) => resources.add(absolute(element.getAttribute("poster"))));
  document.querySelectorAll("source[src], video[src], audio[src]").forEach((element) => resources.add(absolute(element.getAttribute("src"))));
  return {
    url: location.href,
    title: document.title || location.pathname,
    contentType: document.contentType,
    links,
    resourceUrls: [...resources].filter((url) => /^https?:/i.test(url)),
    stylesheetTexts: [...document.styleSheets].map((sheet) => {
      try { return { url: sheet.href || document.baseURI, css: [...sheet.cssRules].map((rule) => rule.cssText).join("\\n") }; }
      catch { return null; }
    }).filter(Boolean),
    userAgent: navigator.userAgent,
  };
})()`;

async function inspectContents(contents) {
  const result = await executeInPage(contents, inspectionScript);
  return { ...result, inspectedAt: new Date().toISOString() };
}

async function fetchResource(url, failures) {
  // Script and beacon requests are deliberately not embedded in the offline
  // copy.  Do not turn those expected omissions into capture warnings.
  const intentionallyExcluded = (contentType = "") => {
    const pathname = new URL(url, "https://example.com").pathname.toLowerCase();
    return /\.(?:js|mjs|cjs)(?:$|\.)/.test(pathname)
      || /^(?:application|text)\/(?:x-)?(?:javascript|ecmascript)$/i.test(contentType)
      || /^text\/plain$/i.test(contentType);
  };
  const addFailure = (reason) => {
    if (failures.length >= 20) return;
    failures.push({ url: redactUrl(url).slice(0, 240), reason: String(reason || "取得に失敗").slice(0, 160) });
  };
  if (intentionallyExcluded()) return null;
  try {
    const response = await captureSession.fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) {
      addFailure(`HTTP ${response.status}`);
      return null;
    }
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > MAX_RESOURCE_BYTES) {
      addFailure(`ファイルが${Math.ceil(MAX_RESOURCE_BYTES / 1024 / 1024)}MBを超過`);
      return null;
    }
    let contentType = response.headers.get("content-type")?.split(";")[0]?.trim() || "";
    if (!contentType || contentType === "application/octet-stream") {
      const pathname = new URL(url, "https://example.com").pathname.toLowerCase();
      const extMatch = pathname.match(/\.(png|jpe?g|gif|webp|svg|ico|avif|bmp|woff2?|ttf|otf|css)$/);
      if (extMatch) {
        const ext = extMatch[1];
        if (ext === "css") contentType = "text/css";
        else if (ext === "svg") contentType = "image/svg+xml";
        else if (ext === "ico") contentType = "image/x-icon";
        else if (ext === "jpg" || ext === "jpeg") contentType = "image/jpeg";
        else if (ext === "woff" || ext === "woff2" || ext === "ttf" || ext === "otf") contentType = `font/${ext}`;
        else contentType = `image/${ext}`;
      }
    }
    if (!(contentType === "text/css" || /^(image|font|audio|video)\//i.test(contentType) || /font/i.test(contentType))) {
      if (intentionallyExcluded(contentType)) return null;
      addFailure(`非対応のContent-Type (${contentType || "不明"})`);
      return null;
    }
    return { body, contentType };
  } catch (error) {
    addFailure(error.message);
    const failure = { url: redactUrl(url), message: error.message || "取得に失敗" };
    await record("resource-failed", failure);
    return null;
  }
}

async function captureCurrentPage({ includeScreenshot = true, window = ensurePageWindow() } = {}) {
  const win = window;
  if (!/^https?:/i.test(win.webContents.getURL())) throw new Error("先に対象ページを開いてください。");
  progress("表示中ページを解析しています…");
  await executeInPage(win.webContents, `new Promise(async (resolve) => {
    const startX = scrollX; const startY = scrollY; const step = Math.max(500, Math.floor(innerHeight * 0.8));
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) { scrollTo(0, y); await new Promise((done) => setTimeout(done, 70)); }
    scrollTo(startX, startY); resolve(true);
  })`).catch(() => {});
  const metadata = await inspectContents(win.webContents);
  const assets = new Map();
  const cssSources = new Map(metadata.stylesheetTexts.map(({ url, css }) => [url, css]));
  const queue = [...new Set(metadata.resourceUrls)];
  const resourceFailures = [];
  cssSources.forEach((css, url) => extractCssUrls(css, url).forEach((nested) => queue.push(nested)));
  let totalBytes = 0;
  for (let index = 0; index < queue.length && totalBytes < MAX_TOTAL_BYTES; index += 1) {
    const url = queue[index];
    if (!/^https?:/i.test(url) || assets.has(url) || cssSources.has(url)) continue;
    progress(`関連ファイルを取得しています（${index + 1}/${queue.length}）`);
    const resource = await fetchResource(url, resourceFailures);
    if (!resource) continue;
    totalBytes += resource.body.length;
    if (resource.contentType === "text/css") {
      const css = resource.body.toString("utf8");
      cssSources.set(url, css);
      extractCssUrls(css, url).forEach((nested) => queue.push(nested));
    } else {
      assets.set(url, `data:${resource.contentType};base64,${resource.body.toString("base64")}`);
    }
  }
  const rewrittenCss = new Map();
  cssSources.forEach((css, url) => rewrittenCss.set(url, rewriteCss(inlineCssImports(css, url, cssSources, new Set([url])), url, assets)));
  progress("自己完結HTMLを生成しています…");
  const payload = { assetEntries: [...assets], cssEntries: [...rewrittenCss], capturedUrl: metadata.url };
  const html = await executeInPage(win.webContents, `(() => {
    const payload = ${toScriptValue(payload)};
    const assetMap = new Map(payload.assetEntries); const cssMap = new Map(payload.cssEntries);
    const sourceRoot = document.documentElement; const cloneRoot = sourceRoot.cloneNode(true);
    const sourceElements = [sourceRoot, ...sourceRoot.querySelectorAll("*")]; const cloneElements = [cloneRoot, ...cloneRoot.querySelectorAll("*")];
    const absolute = (value, base = document.baseURI) => { try { return new URL(value, base).href; } catch { return ""; } };
    const rewriteStyle = (css, base) => String(css).replace(/url\\(\\s*(['"]?)(.*?)\\1\\s*\\)/gim, (whole, _quote, value) => {
      if (!value || /^(data:|blob:|#)/i.test(value.trim())) return whole;
      const url = absolute(value.trim(), base); return assetMap.has(url) ? 'url("' + assetMap.get(url) + '")' : whole;
    });
    sourceElements.forEach((source, index) => {
      const copy = cloneElements[index]; if (!copy) return;
      [...copy.attributes].forEach((attribute) => { if (attribute.name.toLowerCase().startsWith("on")) copy.removeAttribute(attribute.name); });
      if (source.tagName === "IMG") { const url = source.currentSrc || absolute(source.getAttribute("src")); if (assetMap.has(url)) copy.setAttribute("src", assetMap.get(url)); copy.removeAttribute("srcset"); }
      else if (source.hasAttribute?.("src")) { const url = absolute(source.getAttribute("src")); if (assetMap.has(url)) copy.setAttribute("src", assetMap.get(url)); }
      if (source.hasAttribute?.("poster")) { const url = absolute(source.getAttribute("poster")); if (assetMap.has(url)) copy.setAttribute("poster", assetMap.get(url)); }
      if (source.hasAttribute?.("style")) copy.setAttribute("style", rewriteStyle(source.getAttribute("style"), document.baseURI));
    });
    [...cloneRoot.querySelectorAll("link[rel~='stylesheet'][href]")].forEach((link) => {
      const url = absolute(link.getAttribute("href")); const css = cssMap.get(url); if (!css) return;
      const style = document.createElement("style"); style.dataset.capturedFrom = url; style.textContent = css; link.replaceWith(style);
    });
    cloneRoot.querySelectorAll("style").forEach((style) => { if (!style.dataset.capturedFrom) style.textContent = rewriteStyle(style.textContent, document.baseURI); });
    cloneRoot.querySelectorAll("script, meta[http-equiv='refresh' i], meta[http-equiv='content-security-policy' i]").forEach((element) => element.remove());
    cloneRoot.querySelector("base")?.remove();
    const meta = document.createElement("meta"); meta.name = "web-revision-source-url"; meta.content = payload.capturedUrl; cloneRoot.querySelector("head")?.prepend(meta);
    return "<!doctype html>\\n" + cloneRoot.outerHTML;
  })()`);
  // The editor only needs HTML here. On Windows, capturing a hidden window a
  // second time can fail with UnknownVizError because its compositor is idle.
  const screenshot = includeScreenshot ? (await win.webContents.capturePage()).toPNG() : undefined;
  lastInspection = metadata;
  lastCapture = {
    html,
    screenshot,
    metadata,
    statistics: { assets: assets.size, stylesheets: cssSources.size, embeddedBytes: totalBytes },
    resourceFailures,
    capturedAt: new Date().toISOString(),
  };
  await record("capture-complete", { url: redactUrl(metadata.url), ...lastCapture.statistics });
  progress("ページ取得が完了しました。", { done: true });
  return { metadata, statistics: lastCapture.statistics, capturedAt: lastCapture.capturedAt };
}

async function captureUrlInFreshWindow(url) {
  const target = normalizeHttpUrl(url, url).href;
  const win = createBackgroundPageWindow("Web Revision Desk - ページ取得中");
  try {
    await withNavigationTimeout(win.webContents, target);
    const captured = await captureCurrentPage({ includeScreenshot: false, window: win });
    return { ...lastCapture, ...captured };
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

async function screenshotUrlInFreshWindow(url) {
  const target = normalizeHttpUrl(url, url).href;
  const win = createBackgroundPageWindow("Web Revision Desk - プレビュー取得中");
  try {
    await withNavigationTimeout(win.webContents, target);
    const metadata = await inspectContents(win.webContents);
    const image = (await win.webContents.capturePage()).toJPEG(78);
    return { metadata, image };
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

async function crawl(baseUrl, requestedMax) {
  const base = normalizeHttpUrl(baseUrl, baseUrl);
  const maxPages = Math.min(100, Math.max(1, Number(requestedMax) || 30));
  const crawler = new BrowserWindow({ show: false, webPreferences: secureWebPreferences() });
  attachRemoteGuards(crawler.webContents);
  const queue = [base.href];
  const queued = new Set(queue);
  const visited = new Set();
  const pages = [];
  const errors = [];
  try {
    while (queue.length && pages.length < maxPages) {
      const url = queue.shift();
      progress(`配下ページを確認しています（${pages.length + 1}/${maxPages}）`, { url: redactUrl(url) });
      try {
        await withNavigationTimeout(crawler.webContents, url);
        const detail = await inspectContents(crawler.webContents);
        const finalUrl = normalizeHttpUrl(detail.url, base.href);
        if (!isCrawlTarget(finalUrl.href, base.href) || visited.has(finalUrl.href) || !String(detail.contentType).includes("html")) continue;
        visited.add(finalUrl.href);
        pages.push({ url: finalUrl.href, title: detail.title });
        for (const link of detail.links) {
          try {
            const normalized = normalizeHttpUrl(link, finalUrl.href);
            if (!isCrawlTarget(normalized.href, base.href) || queued.has(normalized.href)) continue;
            queued.add(normalized.href);
            queue.push(normalized.href);
          } catch {}
        }
      } catch (error) {
        errors.push({ url, message: error.message });
      }
    }
  } finally {
    crawler.destroy();
  }
  lastCrawl = { baseUrl: base.href, pages, errors, truncated: queue.length > 0, maxPages, completedAt: new Date().toISOString() };
  await record("crawl-complete", { baseUrl: redactUrl(base.href), pages: pages.length, errors: errors.length });
  progress(`配下ページ確認が完了しました（${pages.length}ページ）。`, { done: true });
  return lastCrawl;
}

async function diagnostics() {
  const currentUrl = pageWindow?.webContents.getURL() || "";
  let proxy = "未確認";
  if (/^https?:/i.test(currentUrl)) proxy = await captureSession.resolveProxy(currentUrl).catch((error) => `確認失敗: ${error.message}`);
  return {
    generatedAt: new Date().toISOString(),
    appVersion: packageJson.version,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    architecture: process.arch,
    currentUrl: redactUrl(currentUrl),
    proxy,
    userDataDirectory: app.getPath("userData"),
    events: diagnosticEvents,
  };
}

async function saveArtifacts() {
  if (!lastCapture || lastCapture.metadata.url !== pageWindow?.webContents.getURL()) await captureCurrentPage();
  const selected = await dialog.showOpenDialog(mainWindow, {
    title: "Electron検証結果の保存先を選択",
    properties: ["openDirectory", "createDirectory"],
  });
  if (selected.canceled || !selected.filePaths[0]) return { canceled: true };
  const baseName = safeArtifactBaseName(lastCapture.metadata.title);
  const outputDirectory = path.join(selected.filePaths[0], `${baseName}-electron-feasibility`);
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(path.join(outputDirectory, "captured.html"), lastCapture.html, "utf8"),
    writeFile(path.join(outputDirectory, "screenshot.png"), lastCapture.screenshot),
    writeFile(path.join(outputDirectory, "links.json"), `${JSON.stringify(lastCapture.metadata.links, null, 2)}\n`, "utf8"),
    writeFile(path.join(outputDirectory, "capture.json"), `${JSON.stringify({
      url: lastCapture.metadata.url,
      title: lastCapture.metadata.title,
      statistics: lastCapture.statistics,
      capturedAt: lastCapture.capturedAt,
    }, null, 2)}\n`, "utf8"),
    writeFile(path.join(outputDirectory, "crawl.json"), `${JSON.stringify(lastCrawl || { notRun: true }, null, 2)}\n`, "utf8"),
    writeFile(path.join(outputDirectory, "diagnostics.json"), `${JSON.stringify(await diagnostics(), null, 2)}\n`, "utf8"),
  ]);
  await record("artifacts-saved", { directory: outputDirectory });
  return { canceled: false, directory: outputDirectory };
}

function encodedHeader(value) {
  return encodeURIComponent(String(value || ""));
}

function capturedFileName(metadata) {
  return `${safeArtifactBaseName(metadata.title || "captured-page")}.html`;
}

function ipcResponse(body, { status = 200, headers = {} } = {}) {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ""), "utf8");
  return { status, headers, bodyBase64: buffer.toString("base64") };
}

function jsonResponse(value, status = 200) {
  return ipcResponse(JSON.stringify(value), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

const RELEASE_API_URL = "https://api.github.com/repos/MZ-Gen-Labs/WebRevisionDesk/releases/latest";
const VERSION_TAG = /^v?(\d+)\.(\d+)\.(\d+)$/;

function compareVersions(left, right) {
  const a = String(left).match(VERSION_TAG);
  const b = String(right).match(VERSION_TAG);
  if (!a || !b) throw new Error("更新バージョンの形式が正しくありません。");
  for (let index = 1; index <= 3; index += 1) {
    const difference = Number(a[index]) - Number(b[index]);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

function portableInstallDirectory() {
  if (process.platform !== "win32" || !app.isPackaged) return "";
  const directory = path.dirname(process.execPath);
  return path.basename(process.execPath).toLowerCase() === "webrevisiondesk.exe" ? directory : "";
}

async function fetchLatestRelease() {
  const response = await net.fetch(RELEASE_API_URL, { headers: { Accept: "application/vnd.github+json", "User-Agent": "WebRevisionDesk" } });
  if (!response.ok) throw new Error(`更新情報を取得できませんでした（HTTP ${response.status}）。`);
  const release = await response.json();
  const version = String(release.tag_name || "").replace(/^v/, "");
  const zip = release.assets?.find((asset) => /^WebRevisionDesk-\d+\.\d+\.\d+-electron-win-x64\.zip$/.test(asset.name));
  const sums = release.assets?.find((asset) => asset.name === "SHA256SUMS.txt");
  if (!zip || !sums || !VERSION_TAG.test(version)) throw new Error("更新リリースの配布ファイルが見つかりません。");
  return { version, zipUrl: zip.browser_download_url, zipName: zip.name, sumsUrl: sums.browser_download_url, notes: String(release.body || "") };
}

async function checkForUpdate() {
  const installDirectory = portableInstallDirectory();
  if (!installDirectory) return { supported: false, currentVersion: packageJson.version };
  const release = await fetchLatestRelease();
  return { supported: true, currentVersion: packageJson.version, available: compareVersions(release.version, packageJson.version) > 0, ...release };
}

async function downloadUpdate() {
  const update = await checkForUpdate();
  if (!update.available) return { ...update, downloaded: false };
  const sumsResponse = await net.fetch(update.sumsUrl, { headers: { "User-Agent": "WebRevisionDesk" } });
  const zipResponse = await net.fetch(update.zipUrl, { headers: { "User-Agent": "WebRevisionDesk" } });
  if (!sumsResponse.ok || !zipResponse.ok) throw new Error("更新ファイルをダウンロードできませんでした。");
  const sums = await sumsResponse.text();
  const expected = sums.match(new RegExp(`^([a-fA-F0-9]{64})\\s+${update.zipName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"))?.[1];
  if (!expected) throw new Error("公開されたSHA-256チェックサムが見つかりません。");
  const body = Buffer.from(await zipResponse.arrayBuffer());
  const actual = createHash("sha256").update(body).digest("hex");
  if (actual.toLowerCase() !== expected.toLowerCase()) throw new Error("更新ファイルのSHA-256が一致しません。");
  const updatesDirectory = path.join(app.getPath("userData"), "updates");
  await mkdir(updatesDirectory, { recursive: true });
  const zipPath = path.join(updatesDirectory, update.zipName);
  await writeFile(zipPath, body);
  downloadedUpdate = { ...update, zipPath, sha256: actual, installDirectory: portableInstallDirectory() };
  await record("update-downloaded", { version: update.version });
  return { ...update, downloaded: true };
}

function applyDownloadedUpdate() {
  if (!downloadedUpdate?.zipPath || !portableInstallDirectory()) throw new Error("適用できる更新ファイルがありません。");
  const script = path.join(rootDirectory, "electron", "updater.ps1");
  const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script,
    "-ProcessId", String(process.pid), "-InstallDirectory", downloadedUpdate.installDirectory,
    "-ZipPath", downloadedUpdate.zipPath, "-Sha256", downloadedUpdate.sha256, "-ExecutableName", path.basename(process.execPath)], {
    detached: true, stdio: "ignore", windowsHide: true,
  });
  child.unref();
  allowMainWindowClose = true;
  app.quit();
  return { restarting: true };
}

async function readEditorSettings() {
  try {
    return JSON.parse(await readFile(path.join(app.getPath("userData"), "settings.json"), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return {};
  }
}

async function writeEditorSettings(settings) {
  const current = await readEditorSettings();
  const next = {
    ...current,
    ...settings,
    lastProjectDirectory: String(settings.lastProjectDirectory ?? current.lastProjectDirectory ?? ""),
    recentProjects: Array.isArray(settings.recentProjects) ? settings.recentProjects.slice(0, 12) : current.recentProjects || [],
  };
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(path.join(app.getPath("userData"), "settings.json"), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

async function rememberRecentProject(directory) {
  const settings = await readEditorSettings();
  const normalized = path.resolve(directory);
  const recentProjects = [
    { path: normalized, name: path.basename(normalized), lastOpenedAt: new Date().toISOString() },
    ...(settings.recentProjects || []).filter((item) => typeof item?.path === "string" && path.resolve(item.path) !== normalized),
  ].slice(0, 12);
  await writeEditorSettings({ ...settings, lastProjectDirectory: normalized, recentProjects });
  return recentProjects;
}

async function openCapturePage(url, { show = true } = {}) {
  const target = normalizeHttpUrl(url, url).href;
  const win = ensurePageWindow();
  if (show) win.show();
  progress("対象ページを開いています…", { url: redactUrl(target) });
  await withNavigationTimeout(win.webContents, target);
  if (show) win.focus();
  lastInspection = await inspectContents(win.webContents);
  lastCapture = undefined;
  await record("page-opened", { url: redactUrl(lastInspection.url), title: lastInspection.title });
  return lastInspection;
}

async function handleEditorApi({ url, method, bodyBase64 }) {
  const body = bodyBase64 ? JSON.parse(Buffer.from(bodyBase64, "base64").toString("utf8")) : {};
  if (method === "GET" && url === "/api/app-info") {
    return jsonResponse({ version: packageJson.version });
  }
  if (method === "GET" && url === "/api/update/check") return jsonResponse(await checkForUpdate());
  if (method === "POST" && url === "/api/update/download") return jsonResponse(await downloadUpdate());
  if (method === "POST" && url === "/api/update/apply") return jsonResponse(applyDownloadedUpdate());
  if (method === "POST" && url === "/api/capture/start") {
    const metadata = await openCapturePage(body.url, { show: true });
    activeCaptureSessionId = crypto.randomUUID();
    return jsonResponse({ sessionId: activeCaptureSessionId, url: metadata.url });
  }
  if (method === "POST" && url === "/api/capture/finish") {
    if (!activeCaptureSessionId || body.sessionId !== activeCaptureSessionId) throw new Error("取得セッションが見つかりません。");
    await captureCurrentPage({ includeScreenshot: false });
    activeCaptureSessionId = "";
    closePageWindow();
    return ipcResponse(lastCapture.html, { headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Captured-Filename": encodedHeader(capturedFileName(lastCapture.metadata)),
      "X-Captured-Url": encodedHeader(lastCapture.metadata.url),
      "X-Captured-Resource-Failures": encodedHeader(JSON.stringify(lastCapture.resourceFailures)),
    } });
  }
  if (method === "POST" && (url === "/api/capture/cancel" || url === "/api/login/finish")) {
    if (body.sessionId && activeCaptureSessionId && body.sessionId !== activeCaptureSessionId) throw new Error("取得セッションが一致しません。");
    activeCaptureSessionId = "";
    closePageWindow();
    return jsonResponse({ ok: true });
  }
  if (method === "POST" && url === "/api/capture/direct") {
    const captured = await captureUrlInFreshWindow(body.url);
    return ipcResponse(captured.html, { headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Captured-Filename": encodedHeader(capturedFileName(captured.metadata)),
      "X-Captured-Url": encodedHeader(captured.metadata.url),
      "X-Captured-Resource-Failures": encodedHeader(JSON.stringify(captured.resourceFailures || [])),
    } });
  }
  if (method === "POST" && url === "/api/preview/screenshot") {
    const { metadata, image } = await screenshotUrlInFreshWindow(body.url);
    return ipcResponse(image, { headers: {
      "Content-Type": "image/jpeg",
      "X-Preview-Title": encodedHeader(metadata.title),
      "X-Preview-Url": encodedHeader(metadata.url),
    } });
  }
  if (method === "POST" && url === "/api/crawl") return jsonResponse(await crawl(body.baseUrl, body.maxPages));
  return jsonResponse({ error: "対応していない操作です。" }, 404);
}

function validatedProjectPath(parts = []) {
  if (!projectDirectory) throw new Error("先に案件フォルダを選択してください。");
  if (!Array.isArray(parts) || parts.some((part) => !part || part === "." || part === ".." || /[\\/\0]/.test(part))) {
    throw new Error("不正なファイルパスです。");
  }
  const target = path.resolve(projectDirectory, ...parts);
  if (target !== projectDirectory && !target.startsWith(`${projectDirectory}${path.sep}`)) throw new Error("案件フォルダ外にはアクセスできません。");
  return target;
}

function fileResultError(error) {
  const errorName = error.code === "ENOENT" ? "NotFoundError"
    : ["ENOTEMPTY", "EEXIST"].includes(error.code) ? "InvalidModificationError"
      : error.name || "Error";
  return { ok: false, errorName, message: error.message };
}

async function handleFileSystem({ operation, parts = [], create = false, content = "", contentBase64 = "", suggestedName = "", filters = [], recursive = false }) {
  try {
    if (operation === "select") {
      const settings = await readEditorSettings();
      const selected = await dialog.showOpenDialog(mainWindow, {
        title: "案件フォルダを選択",
        defaultPath: settings.lastProjectDirectory || undefined,
        properties: ["openDirectory", "createDirectory"],
      });
      if (selected.canceled || !selected.filePaths[0]) return { ok: true, value: null };
      projectDirectory = path.resolve(selected.filePaths[0]);
      await rememberRecentProject(projectDirectory);
      return { ok: true, value: { name: path.basename(projectDirectory) } };
    }
    if (operation === "recent-list") {
      const settings = await readEditorSettings();
      const recentProjects = (settings.recentProjects || []).filter((item) => typeof item?.path === "string" && typeof item?.name === "string");
      if (!recentProjects.length && settings.lastProjectDirectory) {
        const previous = path.resolve(settings.lastProjectDirectory);
        recentProjects.push({ path: previous, name: path.basename(previous), lastOpenedAt: null });
      }
      return { ok: true, value: recentProjects };
    }
    if (operation === "open-recent") {
      const settings = await readEditorSettings();
      const requested = path.resolve(String(parts[0] || ""));
      const known = (settings.recentProjects || []).some((item) => typeof item?.path === "string" && path.resolve(item.path) === requested);
      if (!known) throw new Error("履歴にない案件フォルダです。");
      if (!(await stat(requested)).isDirectory()) throw Object.assign(new Error("案件フォルダが見つかりません。"), { code: "ENOENT" });
      projectDirectory = requested;
      await rememberRecentProject(projectDirectory);
      return { ok: true, value: { name: path.basename(projectDirectory) } };
    }
    if (operation === "remove-recent") {
      const settings = await readEditorSettings();
      const requested = path.resolve(String(parts[0] || ""));
      const recentProjects = (settings.recentProjects || []).filter((item) => typeof item?.path === "string" && path.resolve(item.path) !== requested);
      const lastProjectDirectory = settings.lastProjectDirectory && path.resolve(settings.lastProjectDirectory) === requested
        ? ""
        : settings.lastProjectDirectory;
      await writeEditorSettings({ ...settings, lastProjectDirectory, recentProjects });
      return { ok: true, value: recentProjects };
    }
    if (operation === "save-output") {
      const selected = await dialog.showSaveDialog(mainWindow, {
        title: "保存先を選択",
        defaultPath: path.basename(String(suggestedName || "web-revision-output")),
        filters: Array.isArray(filters) ? filters : [],
      });
      if (selected.canceled || !selected.filePath) return { ok: true, value: null };
      await writeFile(selected.filePath, Buffer.from(String(contentBase64), "base64"));
      return { ok: true, value: { path: selected.filePath } };
    }
    const target = validatedProjectPath(parts);
    if (operation === "ensure-directory") {
      if (create) await mkdir(target, { recursive: true });
      else if (!(await stat(target)).isDirectory()) throw Object.assign(new Error("フォルダではありません。"), { code: "ENOENT" });
    } else if (operation === "ensure-file") {
      if (create) {
        await mkdir(path.dirname(target), { recursive: true });
        try { await stat(target); } catch (error) { if (error.code === "ENOENT") await writeFile(target, "", { flag: "wx" }); else throw error; }
      } else if (!(await stat(target)).isFile()) throw Object.assign(new Error("ファイルではありません。"), { code: "ENOENT" });
    } else if (operation === "read-text") return { ok: true, value: await readFile(target, "utf8") };
    else if (operation === "write-text") {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, String(content), "utf8");
    } else if (operation === "remove") await removeProjectEntry(target, recursive);
    else throw new Error("対応していないファイル操作です。");
    return { ok: true, value: true };
  } catch (error) {
    return fileResultError(error);
  }
}

function registerIpc() {
  ipcMain.handle("editor:api-request", async (event, request) => {
    assertTrustedSender(event);
    const browserPaths = new Set([
      "/api/capture/start", "/api/login/finish", "/api/capture/finish", "/api/capture/cancel",
      "/api/crawl", "/api/preview/screenshot", "/api/capture/direct",
    ]);
    const run = () => handleEditorApi(request);
    const priority = request.headers?.["x-browser-task-priority"] === "interactive" ? "interactive" : "normal";
    try { return browserPaths.has(request.url) ? await browserTaskQueue.enqueue(run, { priority }) : await run(); }
    catch (error) { return jsonResponse({ error: error.message || "処理に失敗しました。" }, 400); }
  });
  ipcMain.handle("editor:file-system", async (event, request) => {
    assertTrustedSender(event);
    return handleFileSystem(request);
  });
  ipcMain.handle("feasibility:get-info", async (event) => {
    assertTrustedSender(event);
    return diagnostics();
  });
  ipcMain.handle("feasibility:open-page", async (event, { url }) => {
    assertTrustedSender(event);
    const target = normalizeHttpUrl(url, url).href;
    const win = ensurePageWindow();
    win.show();
    progress("対象ページを開いています…", { url: redactUrl(target) });
    await withNavigationTimeout(win.webContents, target);
    win.focus();
    lastInspection = await inspectContents(win.webContents);
    lastCapture = undefined;
    await record("page-opened", { url: redactUrl(lastInspection.url), title: lastInspection.title });
    progress("対象ページを表示しました。ログインや画面操作を行えます。", { done: true });
    return { url: lastInspection.url, title: lastInspection.title, links: lastInspection.links.length, resources: lastInspection.resourceUrls.length };
  });
  ipcMain.handle("feasibility:show-page", async (event) => {
    assertTrustedSender(event);
    const win = ensurePageWindow();
    win.show();
    win.focus();
    return { url: win.webContents.getURL() };
  });
  ipcMain.handle("feasibility:inspect-page", async (event) => {
    assertTrustedSender(event);
    const win = ensurePageWindow();
    if (!/^https?:/i.test(win.webContents.getURL())) throw new Error("先に対象ページを開いてください。");
    lastInspection = await inspectContents(win.webContents);
    await record("page-inspected", { url: redactUrl(lastInspection.url), links: lastInspection.links.length, resources: lastInspection.resourceUrls.length });
    return { url: lastInspection.url, title: lastInspection.title, links: lastInspection.links.length, resources: lastInspection.resourceUrls.length, contentType: lastInspection.contentType };
  });
  ipcMain.handle("feasibility:crawl", async (event, { baseUrl, maxPages }) => {
    assertTrustedSender(event);
    return crawl(baseUrl, maxPages);
  });
  ipcMain.handle("feasibility:save-artifacts", async (event) => {
    assertTrustedSender(event);
    return saveArtifacts();
  });
}

async function createMainWindow({ show = true } = {}) {
  mainWindow = new BrowserWindow({
    width: feasibilityMode ? 1040 : 1600,
    height: feasibilityMode ? 820 : 1000,
    minWidth: 820,
    minHeight: 640,
    show,
    title: feasibilityMode ? "Web Revision Desk - Electron機能検証" : "Web Revision Desk",
    webPreferences: {
      preload: path.join(currentDirectory, feasibilityMode ? "preload.cjs" : "editor-preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  await mainWindow.loadURL("wrd://app/index.html");
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.on("close", (event) => {
    if (feasibilityMode || allowMainWindowClose) return;
    event.preventDefault();
    if (mainWindowClosePending) return;
    mainWindowClosePending = true;
    void (async () => {
      let result;
      try {
        result = await mainWindow.webContents.executeJavaScript("window.webRevisionFlushAutosave?.() ?? Promise.resolve({ ok: true })");
      } catch (error) {
        result = { ok: false, message: error.message };
      }
      if (result?.needsManualSave) {
        const confirmation = await dialog.showMessageBox(mainWindow, {
          type: "warning",
          title: "編集内容が保存されていません",
          message: "案件フォルダに保存されていない編集内容があります。",
          detail: "「終了をキャンセル」を選び、修正後ページまたは共有用ZIPを保存してから終了してください。",
          buttons: ["終了をキャンセル", "保存せず終了"],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        if (confirmation.response !== 1) {
          mainWindowClosePending = false;
          return;
        }
      } else if (!result?.ok) {
        const confirmation = await dialog.showMessageBox(mainWindow, {
          type: "warning",
          title: "編集内容を保存できませんでした",
          message: "未保存の編集内容があります。",
          detail: `${result?.message || "自動保存に失敗しました。"}\n\n保存せずに終了すると、直前の編集内容は失われます。`,
          buttons: ["終了をキャンセル", "保存せず終了"],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        if (confirmation.response !== 1) {
          mainWindowClosePending = false;
          return;
        }
      }
      allowMainWindowClose = true;
      mainWindow.close();
    })();
  });
  mainWindow.on("closed", () => {
    mainWindow = undefined;
    closeAuxiliaryWindows();
    if (!shuttingDown) {
      shuttingDown = true;
      app.quit();
    }
  });
}

async function verifySequentialEditorCaptures() {
  const server = createServer((request, response) => {
    if (request.url === "/fail") {
      request.socket.destroy();
      return;
    }
    const label = request.url === "/two" ? "Page Two" : "Page One";
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><html><head><title>${label}</title></head><body><h1>${label}</h1></body></html>`);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const { port } = server.address();
    const requests = ["one", "two"].map((page) => ({
      url: "/api/capture/direct",
      method: "POST",
      headers: { "content-type": "application/json" },
      bodyBase64: Buffer.from(JSON.stringify({ url: `http://127.0.0.1:${port}/${page}` })).toString("base64"),
    }));
    const replies = await mainWindow.webContents.executeJavaScript(`Promise.all(${toScriptValue(requests)}.map((request) => window.webRevisionDesktop.request(request)))`);
    const pages = replies.map((reply) => Buffer.from(reply.bodyBase64, "base64").toString("utf8"));
    if (replies.some((reply) => reply.status !== 200) || !pages[0].includes("Page One") || !pages[1].includes("Page Two")) {
      throw new Error("Sequential Electron page capture failed.");
    }
    const failureRequest = {
      url: "/api/capture/direct",
      method: "POST",
      headers: { "content-type": "application/json" },
      bodyBase64: Buffer.from(JSON.stringify({ url: `http://127.0.0.1:${port}/fail` })).toString("base64"),
    };
    const failure = await mainWindow.webContents.executeJavaScript(`window.webRevisionDesktop.request(${toScriptValue(failureRequest)})`);
    if (failure.status === 200) throw new Error("Failed capture unexpectedly succeeded.");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

app.on("certificate-error", (_event, _contents, url, error, _certificate, callback) => {
  record("certificate-error", { url: redactUrl(url), error });
  callback(false);
});
app.on("select-client-certificate", (_event, _contents, url, certificates) => {
  record("client-certificate-request", { url: redactUrl(String(url)), certificates: certificates.length });
});
app.on("login", (_event, _contents, details, authInfo) => {
  record("authentication-request", { url: redactUrl(details.url), proxy: authInfo.isProxy, scheme: authInfo.scheme, host: authInfo.host });
});

app.whenReady().then(async () => {
  captureSession = session.fromPartition(CAPTURE_PARTITION);
  captureSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  captureSession.on("will-download", (event, item) => {
    event.preventDefault();
    record("download-blocked", { url: redactUrl(item.getURL()), fileName: item.getFilename() });
  });
  captureSession.webRequest.onErrorOccurred((detail) => record("network-error", { url: redactUrl(detail.url), error: detail.error }));
  session.defaultSession.protocol.handle("wrd", async (request) => {
    const url = new URL(request.url);
    if (url.host !== "app") return new Response("Not found", { status: 404 });
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
    const filePath = path.resolve(uiDirectory, relative);
    if (filePath !== uiDirectory && !filePath.startsWith(`${uiDirectory}${path.sep}`)) return new Response("Forbidden", { status: 403 });
    return net.fetch(pathToFileURL(filePath).href);
  });
  registerIpc();
  await record("application-started", { version: packageJson.version, electron: process.versions.electron });
  if (process.argv.includes("--feasibility-smoke-test")) {
    await createMainWindow({ show: false });
    const title = await mainWindow.webContents.executeJavaScript("document.title");
    if (title !== "Electron機能検証") throw new Error(`Unexpected feasibility page title: ${title}`);
    console.log(`Electron feasibility smoke test passed: ${process.versions.electron} / ${title}`);
    app.quit();
    return;
  }
  if (process.argv.includes("--editor-smoke-test")) {
    await createMainWindow({ show: false });
    const title = await mainWindow.webContents.executeJavaScript("document.title");
    if (title !== "Web Revision Desk") throw new Error(`Unexpected editor page title: ${title}`);
    const desktopApi = await mainWindow.webContents.executeJavaScript("Boolean(window.webRevisionDesktop?.request && window.webRevisionDesktop?.fileSystem)");
    if (!desktopApi) throw new Error("Electron editor bridge was not exposed.");
    const appInfo = await mainWindow.webContents.executeJavaScript(`window.webRevisionDesktop.request({ url: "/api/app-info", method: "GET", headers: {}, bodyBase64: "" })`);
    const appInfoBody = JSON.parse(Buffer.from(appInfo.bodyBase64, "base64").toString("utf8"));
    if (appInfo.status !== 200 || appInfoBody.version !== packageJson.version) throw new Error("Electron editor API did not return application information.");
    await verifySequentialEditorCaptures();
    if (backgroundWindows.size !== 0) throw new Error("Background capture windows were not released.");
    console.log(`Electron editor smoke test passed: ${process.versions.electron} / ${title}`);
    app.quit();
    return;
  }
  await createMainWindow();
});

app.on("before-quit", () => {
  shuttingDown = true;
  closeAuxiliaryWindows();
});
app.on("window-all-closed", () => app.quit());
