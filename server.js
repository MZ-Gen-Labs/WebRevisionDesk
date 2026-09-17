import http from "node:http";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createServer as createViteServer } from "vite";
import { chromium } from "playwright";
import { capturePage } from "./src/capture-page.js";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const profileDir = path.join(rootDir, "work", "capture-profile");
const sessions = new Map();
await mkdir(profileDir, { recursive: true });

const vite = await createViteServer({
  root: rootDir,
  server: { middlewareMode: true },
  appType: "spa",
});

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

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/api/capture/start") return await startCapture(request, response);
    if (request.method === "POST" && request.url === "/api/capture/finish") return await finishCapture(request, response);
    if (request.method === "POST" && request.url === "/api/capture/cancel") return await cancelCapture(request, response);
    if (request.method === "POST" && request.url === "/api/crawl") return await crawlSite(request, response);
    if (request.method === "POST" && request.url === "/api/capture/direct") return await captureDirect(request, response);
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
  await vite.close();
  server.close();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
