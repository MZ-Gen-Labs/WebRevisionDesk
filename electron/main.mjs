import { app, BrowserWindow, dialog, ipcMain, net, protocol, session } from "electron";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  isCrawlTarget,
  normalizeHttpUrl,
  redactUrl,
  safeArtifactBaseName,
} from "../src/electron-feasibility-core.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(currentDirectory, "..");
const uiDirectory = path.join(currentDirectory, "ui");
const packageJson = JSON.parse(await readFile(path.join(rootDirectory, "package.json"), "utf8"));
const CAPTURE_PARTITION = "persist:web-revision-electron-feasibility";
const MAX_RESOURCE_BYTES = 15 * 1024 * 1024;
const MAX_TOTAL_BYTES = 60 * 1024 * 1024;
const navigationTimeoutMs = 45_000;

let mainWindow;
let pageWindow;
let captureSession;
let lastInspection;
let lastCapture;
let lastCrawl;
const diagnosticEvents = [];

protocol.registerSchemesAsPrivileged([{
  scheme: "wrd",
  privileges: { standard: true, secure: true, supportFetchAPI: true },
}]);
app.setName("WebRevisionDeskElectronFeasibility");
app.setPath("userData", path.join(app.getPath("appData"), "WebRevisionDesk", "electron-feasibility"));

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

async function fetchResource(url) {
  try {
    const response = await captureSession.fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) return null;
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > MAX_RESOURCE_BYTES) return null;
    const contentType = response.headers.get("content-type")?.split(";")[0] || "application/octet-stream";
    if (!(contentType === "text/css" || /^(image|font|audio|video)\//i.test(contentType) || /font/i.test(contentType))) return null;
    return { body, contentType };
  } catch (error) {
    await record("resource-failed", { url: redactUrl(url), message: error.message });
    return null;
  }
}

async function captureCurrentPage() {
  const win = ensurePageWindow();
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
  cssSources.forEach((css, url) => extractCssUrls(css, url).forEach((nested) => queue.push(nested)));
  let totalBytes = 0;
  for (let index = 0; index < queue.length && totalBytes < MAX_TOTAL_BYTES; index += 1) {
    const url = queue[index];
    if (!/^https?:/i.test(url) || assets.has(url) || cssSources.has(url)) continue;
    progress(`関連ファイルを取得しています（${index + 1}/${queue.length}）`);
    const resource = await fetchResource(url);
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
  const screenshot = (await win.webContents.capturePage()).toPNG();
  lastInspection = metadata;
  lastCapture = {
    html,
    screenshot,
    metadata,
    statistics: { assets: assets.size, stylesheets: cssSources.size, embeddedBytes: totalBytes },
    capturedAt: new Date().toISOString(),
  };
  await record("capture-complete", { url: redactUrl(metadata.url), ...lastCapture.statistics });
  progress("ページ取得が完了しました。", { done: true });
  return { metadata, statistics: lastCapture.statistics, capturedAt: lastCapture.capturedAt };
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

function registerIpc() {
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
    width: 1040,
    height: 820,
    minWidth: 820,
    minHeight: 640,
    show,
    title: "Web Revision Desk - Electron機能検証",
    webPreferences: {
      preload: path.join(currentDirectory, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  await mainWindow.loadURL("wrd://app/index.html");
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.on("closed", () => { mainWindow = undefined; });
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
  await createMainWindow();
});

app.on("window-all-closed", () => app.quit());
