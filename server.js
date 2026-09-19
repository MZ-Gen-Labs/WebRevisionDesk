import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { capturePage } from "./src/capture-page.js";
import { BrowserTaskQueue } from "./src/browser-task-queue.js";
import { createUpdateService } from "./src/update-service.js";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(await readFile(path.join(rootDir, "package.json"), "utf8"));
const updateService = await createUpdateService({
  appVersion: packageJson.version,
  legacyProfileDirectory: path.join(rootDir, "work", "capture-profile"),
  installRoot: process.env.WEB_REVISION_INSTALL_ROOT,
});
const profileDir = updateService.profileDirectory;
const sessions = new Map();
const screenshotCache = new Map();
const browserTasks = new BrowserTaskQueue();

const productionMode = process.env.WEB_REVISION_PRODUCTION === "1";
const vite = productionMode ? null : await import("vite").then(({ createServer }) => createServer({
  root: rootDir,
  server: { middlewareMode: true },
  appType: "spa",
}));

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"], [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"], [".png", "image/png"], [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"], [".gif", "image/gif"], [".webp", "image/webp"],
  [".ico", "image/x-icon"], [".woff", "font/woff"], [".woff2", "font/woff2"],
]);

async function serveProductionFile(request, response) {
  const requested = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const relative = requested === "/" ? "index.html" : requested.replace(/^\/+/, "");
  let filePath = path.resolve(rootDir, "dist", relative);
  const distRoot = path.resolve(rootDir, "dist");
  if (!filePath.startsWith(`${distRoot}${path.sep}`) && filePath !== path.join(distRoot, "index.html")) {
    response.writeHead(403); response.end("Forbidden"); return;
  }
  try {
    const data = await readFile(filePath);
    response.writeHead(200, { "Content-Type": contentTypes.get(path.extname(filePath).toLowerCase()) || "application/octet-stream" });
    response.end(data);
  } catch (error) {
    if (error.code !== "ENOENT" || path.extname(relative)) {
      response.writeHead(404); response.end("Not found"); return;
    }
    filePath = path.join(distRoot, "index.html");
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(await readFile(filePath));
  }
}

function sendJson(response, status, data) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(data));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error("リクエストが大きすぎます。");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function validateUrl(value) {
  const url = new URL(value);
  if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error("httpまたはhttpsのURLを指定してください。");
  return url.href;
}

function normalizeCrawlUrl(value, baseUrl) {
  const url = new URL(value, baseUrl);
  if (!new Set(["http:", "https:"]).has(url.protocol)) return null;
  url.hash = "";
  [...url.searchParams.keys()].forEach((key) => {
    if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
  });
  url.searchParams.sort();
  url.pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
  return url;
}

function isCrawlTarget(url, base) {
  if (url.origin !== base.origin) return false;
  const baseLastSegment = base.pathname.split("/").filter(Boolean).at(-1) || "";
  const basePath = (baseLastSegment.includes(".")
    ? base.pathname.slice(0, base.pathname.lastIndexOf("/"))
    : base.pathname).replace(/\/$/, "") || "/";
  const path = url.pathname.replace(/\/$/, "") || "/";
  if (!(path === basePath || path.startsWith(basePath === "/" ? "/" : `${basePath}/`))) return false;
  return !/\.(?:avif|bmp|css|csv|docx?|eot|gif|ico|jpe?g|js|json|map|mp3|mp4|mpeg|mov|pdf|png|pptx?|rar|svg|tar|tiff?|txt|wav|webm|webp|woff2?|xlsx?|xml|zip)$/i.test(path);
}

async function crawlSite(request, response) {
  const { baseUrl: inputUrl, maxPages: requestedMax } = await readJson(request);
  if (sessions.size) throw new Error("取得用ブラウザを閉じてから配下ページを検索してください。");
  const validated = validateUrl(inputUrl);
  const base = normalizeCrawlUrl(validated, validated);
  const maxPages = Math.min(300, Math.max(1, Number(requestedMax) || 100));
  const context = await chromium.launchPersistentContext(profileDir, { headless: true });
  const page = context.pages()[0] ?? await context.newPage();
  const queue = [base.href];
  const queued = new Set(queue);
  const visitedPages = new Set();
  const pages = [];
  const errors = [];
  await page.route("**/*", async (route) => {
    if (["image", "media", "font"].includes(route.request().resourceType())) await route.abort();
    else await route.continue();
  });
  try {
    while (queue.length && pages.length < maxPages) {
      const currentUrl = queue.shift();
      try {
        const navigation = await page.goto(currentUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        const contentType = navigation?.headers()["content-type"] || "";
        if (navigation && !contentType.includes("text/html")) continue;
        const finalUrl = normalizeCrawlUrl(page.url(), base.href);
        if (!finalUrl || !isCrawlTarget(finalUrl, base)) continue;
        if (visitedPages.has(finalUrl.href)) continue;
        visitedPages.add(finalUrl.href);
        pages.push({
          url: finalUrl.href,
          title: (await page.title()).trim() || finalUrl.pathname,
          status: navigation?.status() || 0,
        });
        const links = await page.locator("a[href]").evaluateAll((anchors) => anchors.map((anchor) => anchor.href));
        for (const link of links) {
          const normalized = normalizeCrawlUrl(link, finalUrl.href);
          if (!normalized || !isCrawlTarget(normalized, base) || queued.has(normalized.href)) continue;
          queued.add(normalized.href);
          queue.push(normalized.href);
        }
      } catch (error) {
        errors.push({ url: currentUrl, message: error.message });
      }
    }
  } finally {
    await context.close().catch(() => {});
  }
  sendJson(response, 200, {
    baseUrl: base.href,
    pages,
    errors,
    truncated: queue.length > 0,
    maxPages,
  });
}

async function startCapture(request, response) {
  const { url: inputUrl } = await readJson(request);
  const url = validateUrl(inputUrl);
  if (sessions.size) throw new Error("取得用ブラウザはすでに開いています。先に取り込みまたはキャンセルしてください。");
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: null,
    args: ["--start-maximized"],
  });
  const page = context.pages()[0] ?? await context.newPage();
  const sessionId = randomUUID();
  sessions.set(sessionId, { context, page });
  context.on("close", () => sessions.delete(sessionId));
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  } catch (error) {
    // 認証遷移や長時間通信があっても、開いたブラウザで利用者が続行できる。
    console.warn("Initial navigation did not fully settle:", error.message);
  }
  sendJson(response, 200, { sessionId, currentUrl: page.url(), title: await page.title() });
}

async function finishCapture(request, response) {
  const { sessionId } = await readJson(request);
  const session = sessions.get(sessionId);
  if (!session) throw new Error("取得セッションが見つかりません。取得用ブラウザを開き直してください。");
  const pages = session.context.pages();
  const page = pages.at(-1) ?? session.page;
  try {
    const result = await capturePage(page);
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Captured-Filename": encodeURIComponent(result.fileName),
      "X-Captured-Url": encodeURIComponent(result.url),
    });
    response.end(result.html);
  } finally {
    sessions.delete(sessionId);
    await session.context.close().catch(() => {});
  }
}

async function cancelCapture(request, response) {
  const { sessionId } = await readJson(request);
  const session = sessions.get(sessionId);
  if (session) {
    sessions.delete(sessionId);
    await session.context.close().catch(() => {});
  }
  sendJson(response, 200, { ok: true });
}

async function finishLogin(request, response) {
  const { sessionId } = await readJson(request);
  const session = sessions.get(sessionId);
  if (!session) throw new Error("ログイン用ブラウザを開き直してください。");
  await session.context.close();
  sessions.delete(sessionId);
  sendJson(response, 200, { ok: true });
}

async function captureDirect(request, response) {
  const { url: inputUrl } = await readJson(request);
  const url = validateUrl(inputUrl);
  if (sessions.size) throw new Error("取得用ブラウザを閉じてから一括処理を実行してください。");
  const context = await chromium.launchPersistentContext(profileDir, { headless: true });
  const page = context.pages()[0] ?? await context.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    const result = await capturePage(page);
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Captured-Filename": encodeURIComponent(result.fileName),
      "X-Captured-Url": encodeURIComponent(result.url),
    });
    response.end(result.html);
  } finally {
    await context.close().catch(() => {});
  }
}

function sendScreenshot(response, preview, cached = false) {
  response.writeHead(200, {
    "Content-Type": "image/jpeg",
    "Content-Length": preview.image.length,
    "Cache-Control": "no-store",
    "X-Preview-Title": encodeURIComponent(preview.title),
    "X-Preview-Url": encodeURIComponent(preview.url),
    "X-Preview-Cached": cached ? "1" : "0",
  });
  response.end(preview.image);
}

async function previewScreenshot(request, response) {
  const { url: inputUrl, refresh = false } = await readJson(request);
  const url = validateUrl(inputUrl);
  if (sessions.size) throw new Error("取得用ブラウザを閉じてからプレビューしてください。");
  const cached = screenshotCache.get(url);
  if (!refresh && cached && Date.now() - cached.createdAt < 5 * 60 * 1000) {
    return sendScreenshot(response, cached, true);
  }

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = context.pages()[0] ?? await context.newPage();
  let preview;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForLoadState("load", { timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(250);
    preview = {
      image: await page.screenshot({ type: "jpeg", quality: 78, fullPage: false, animations: "disabled" }),
      title: (await page.title()).trim() || new URL(page.url()).pathname,
      url: page.url(),
      createdAt: Date.now(),
    };
  } finally {
    await context.close().catch(() => {});
  }
  if (screenshotCache.size >= 30) screenshotCache.delete(screenshotCache.keys().next().value);
  screenshotCache.set(url, preview);
  sendScreenshot(response, preview);
}

const server = http.createServer(async (request, response) => {
  try {
    const expectedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    if (!expectedHosts.has(request.headers.host)) return sendJson(response, 403, { error: "許可されていない接続先です。" });
    if (request.url.startsWith("/api/")) {
      const origin = request.headers.origin;
      if ((origin && origin !== `http://${request.headers.host}`) || request.headers["sec-fetch-site"] === "cross-site") {
        return sendJson(response, 403, { error: "外部サイトからの操作は許可されていません。" });
      }
      if (request.method === "POST" && !/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] || "")) {
        return sendJson(response, 415, { error: "JSON形式で送信してください。" });
      }
    }
    if (request.method === "GET" && request.url === "/api/app-info") {
      return sendJson(response, 200, {
        version: updateService.appVersion,
        dataDirectory: updateService.dataDirectory,
        canApplyUpdate: await updateService.canApply(),
        settings: await updateService.readSettings(),
      });
    }
    if (request.method === "GET" && request.url === "/api/health") {
      return sendJson(response, 200, { ok: true, version: updateService.appVersion });
    }
    if (request.method === "POST" && request.url === "/api/settings") {
      const { githubRepository, checkUpdatesOnStartup } = await readJson(request);
      return sendJson(response, 200, { settings: await updateService.saveSettings({ githubRepository, checkUpdatesOnStartup }) });
    }
    if (request.method === "POST" && request.url === "/api/update/check") {
      try {
        return sendJson(response, 200, await updateService.check());
      } catch (error) {
        return sendJson(response, 503, { error: error.message || "更新情報を確認できませんでした。" });
      }
    }
    if (request.method === "POST" && request.url === "/api/update/download") {
      return sendJson(response, 200, await updateService.download());
    }
    if (request.method === "POST" && request.url === "/api/update/apply") {
      const result = await updateService.apply();
      sendJson(response, 200, result);
      setTimeout(() => shutdown(), 750);
      return;
    }
    const browserTask = request.method === "POST" && new Map([
      ["/api/capture/start", startCapture],
      ["/api/login/finish", finishLogin],
      ["/api/capture/finish", finishCapture],
      ["/api/capture/cancel", cancelCapture],
      ["/api/crawl", crawlSite],
      ["/api/preview/screenshot", previewScreenshot],
      ["/api/capture/direct", captureDirect],
    ]).get(request.url);
    if (browserTask) {
      const priority = request.headers["x-browser-task-priority"] === "interactive" ? "interactive" : "normal";
      return await browserTasks.enqueue(() => browserTask(request, response), { priority });
    }
    if (productionMode) return await serveProductionFile(request, response);
    vite.middlewares(request, response, () => {
      response.writeHead(404);
      response.end("Not found");
    });
  } catch (error) {
    console.error(error);
    sendJson(response, 400, { error: error.message || "処理に失敗しました。" });
  }
});

const port = Number(process.env.PORT || 5173);
server.listen(port, "127.0.0.1", () => {
  console.log(`Web Revision Editor: http://127.0.0.1:${port}/`);
});

async function shutdown() {
  await Promise.all([...sessions.values()].map(({ context }) => context.close().catch(() => {})));
  await vite?.close();
  server.close();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
