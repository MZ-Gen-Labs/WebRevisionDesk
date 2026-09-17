const MAX_RESOURCE_BYTES = 15 * 1024 * 1024;
const MAX_TOTAL_BYTES = 150 * 1024 * 1024;

function isEmbeddableUrl(value) {
  return typeof value === "string" && /^https?:/i.test(value);
}

function toDataUrl(buffer, contentType) {
  return `data:${contentType || "application/octet-stream"};base64,${buffer.toString("base64")}`;
}

function safeFileName(title) {
  const name = String(title || "captured-page")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return `${name || "captured-page"}.html`;
}

function extractCssUrls(css, baseUrl) {
  const urls = new Set();
  for (const match of css.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gim)) {
    const value = match[2]?.trim();
    if (!value || /^(data:|blob:|#)/i.test(value)) continue;
    try {
      const absolute = new URL(value, baseUrl).href;
      if (isEmbeddableUrl(absolute)) urls.add(absolute);
    } catch {}
  }
  return urls;
}

function rewriteCss(css, baseUrl, assets) {
  return css.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gim, (whole, _quote, value) => {
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
  return css.replace(/@import\s*(?:url\(\s*)?(['"]?)([^'"\s)]+)\1\s*\)?\s*([^;]*);/gim, (whole, _quote, value, mediaQuery) => {
    let importedUrl;
    try {
      importedUrl = new URL(value, baseUrl).href;
    } catch {
      return whole;
    }
    if (seen.has(importedUrl) || !cssSources.has(importedUrl)) return whole;
    const nextSeen = new Set(seen).add(importedUrl);
    const imported = inlineCssImports(cssSources.get(importedUrl), importedUrl, cssSources, nextSeen);
    const media = mediaQuery.trim();
    return media ? `@media ${media} {\n${imported}\n}` : imported;
  });
}

async function fetchResource(request, url) {
  try {
    const response = await request.get(url, { timeout: 20000, failOnStatusCode: false });
    if (!response.ok()) return null;
    const body = await response.body();
    if (body.length > MAX_RESOURCE_BYTES) return null;
    const contentType = response.headers()["content-type"]?.split(";")[0] || "application/octet-stream";
    return { body, contentType };
  } catch {
    return null;
  }
}

async function scrollForLazyContent(page) {
  await page.evaluate(async () => {
    const startX = window.scrollX;
    const startY = window.scrollY;
    const step = Math.max(500, Math.floor(window.innerHeight * 0.8));
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    window.scrollTo(startX, startY);
  });
}

export async function capturePage(page) {
  await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  await scrollForLazyContent(page).catch(() => {});

  const metadata = await page.evaluate(() => {
    const absolute = (value) => {
      try { return new URL(value, document.baseURI).href; } catch { return ""; }
    };
    const urls = new Set(performance.getEntriesByType("resource").map((entry) => entry.name));
    document.querySelectorAll("img").forEach((image) => urls.add(image.currentSrc || absolute(image.getAttribute("src"))));
    document.querySelectorAll("link[rel~='stylesheet'][href]").forEach((link) => urls.add(absolute(link.getAttribute("href"))));
    document.querySelectorAll("[poster]").forEach((element) => urls.add(absolute(element.getAttribute("poster"))));
    document.querySelectorAll("source[src], video[src], audio[src]").forEach((element) => urls.add(absolute(element.getAttribute("src"))));
    return {
      url: location.href,
      title: document.title,
      resourceUrls: [...urls].filter((url) => /^https?:/i.test(url)),
      stylesheetUrls: [...document.querySelectorAll("link[rel~='stylesheet'][href]")].map((link) => absolute(link.getAttribute("href"))),
      stylesheetTexts: [...document.styleSheets].map((sheet) => {
        try {
          return { url: sheet.href || document.baseURI, css: [...sheet.cssRules].map((rule) => rule.cssText).join("\n") };
        } catch {
          return null;
        }
      }).filter(Boolean),
    };
  });

  const assets = new Map();
  const cssSources = new Map(metadata.stylesheetTexts.map(({ url, css }) => [url, css]));
  let totalBytes = 0;
  const queue = [...new Set(metadata.resourceUrls)];
  cssSources.forEach((css, url) => extractCssUrls(css, url).forEach((nestedUrl) => queue.push(nestedUrl)));
  for (let index = 0; index < queue.length; index++) {
    const url = queue[index];
    if (!isEmbeddableUrl(url) || assets.has(url) || cssSources.has(url) || totalBytes >= MAX_TOTAL_BYTES) continue;
    const resource = await fetchResource(page.context().request, url);
    if (!resource) continue;
    totalBytes += resource.body.length;
    if (resource.contentType === "text/css") {
      const css = resource.body.toString("utf8");
      cssSources.set(url, css);
      extractCssUrls(css, url).forEach((nestedUrl) => queue.push(nestedUrl));
    } else {
      assets.set(url, toDataUrl(resource.body, resource.contentType));
    }
  }

  const rewrittenCss = new Map();
  cssSources.forEach((css, url) => {
    const withImports = inlineCssImports(css, url, cssSources, new Set([url]));
    rewrittenCss.set(url, rewriteCss(withImports, url, assets));
  });
  const html = await page.evaluate(({ assetEntries, cssEntries, capturedUrl }) => {
    const assetMap = new Map(assetEntries);
    const cssMap = new Map(cssEntries);
    const sourceRoot = document.documentElement;
    const cloneRoot = sourceRoot.cloneNode(true);
    const sourceElements = [sourceRoot, ...sourceRoot.querySelectorAll("*")];
    const cloneElements = [cloneRoot, ...cloneRoot.querySelectorAll("*")];
    const absolute = (value, base = document.baseURI) => {
      try { return new URL(value, base).href; } catch { return ""; }
    };
    const rewriteStyle = (css, base) => css.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gim, (whole, _quote, value) => {
      if (!value || /^(data:|blob:|#)/i.test(value.trim())) return whole;
      const url = absolute(value.trim(), base);
      return assetMap.has(url) ? `url("${assetMap.get(url)}")` : whole;
    });

    sourceElements.forEach((source, index) => {
      const copy = cloneElements[index];
      if (!copy) return;
      [...copy.attributes].forEach((attribute) => {
        if (attribute.name.toLowerCase().startsWith("on")) copy.removeAttribute(attribute.name);
      });
      if (source.tagName === "IMG") {
        const url = source.currentSrc || absolute(source.getAttribute("src"));
        if (assetMap.has(url)) copy.setAttribute("src", assetMap.get(url));
        copy.removeAttribute("srcset");
      } else if (source.hasAttribute?.("src")) {
        const url = absolute(source.getAttribute("src"));
        if (assetMap.has(url)) copy.setAttribute("src", assetMap.get(url));
      }
      if (source.hasAttribute?.("poster")) {
        const url = absolute(source.getAttribute("poster"));
        if (assetMap.has(url)) copy.setAttribute("poster", assetMap.get(url));
      }
      if (source.hasAttribute?.("style")) copy.setAttribute("style", rewriteStyle(source.getAttribute("style"), document.baseURI));
    });

    [...cloneRoot.querySelectorAll("link[rel~='stylesheet'][href]")].forEach((link) => {
      const url = absolute(link.getAttribute("href"));
      const css = cssMap.get(url);
      if (!css) return;
      const style = document.createElement("style");
      style.setAttribute("data-captured-from", url);
      style.textContent = css;
      link.replaceWith(style);
    });
    cloneRoot.querySelectorAll("style").forEach((style) => {
      if (!style.hasAttribute("data-captured-from")) style.textContent = rewriteStyle(style.textContent, document.baseURI);
    });
    cloneRoot.querySelectorAll("script, meta[http-equiv='refresh' i]").forEach((element) => element.remove());
    cloneRoot.querySelectorAll("meta[http-equiv='content-security-policy' i]").forEach((element) => element.remove());
    cloneRoot.querySelector("base")?.remove();
    const head = cloneRoot.querySelector("head");
    if (head) {
      const meta = document.createElement("meta");
      meta.name = "web-revision-source-url";
      meta.content = capturedUrl;
      head.prepend(meta);
    }
    return "<!doctype html>\n" + cloneRoot.outerHTML;
  }, {
    assetEntries: [...assets.entries()],
    cssEntries: [...rewrittenCss.entries()],
    capturedUrl: metadata.url,
  });

  return { html, url: metadata.url, fileName: safeFileName(metadata.title) };
}
