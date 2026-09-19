export function normalizeHttpUrl(value, baseUrl) {
  const url = new URL(value, baseUrl);
  if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error("httpまたはhttpsのURLを指定してください。");
  url.hash = "";
  [...url.searchParams.keys()].forEach((key) => {
    if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
  });
  url.searchParams.sort();
  url.pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
  return url;
}

export function crawlBasePath(baseUrl) {
  const base = normalizeHttpUrl(baseUrl, baseUrl);
  const lastSegment = base.pathname.split("/").filter(Boolean).at(-1) || "";
  return (lastSegment.includes(".")
    ? base.pathname.slice(0, base.pathname.lastIndexOf("/"))
    : base.pathname).replace(/\/$/, "") || "/";
}

export function isCrawlTarget(value, baseUrl) {
  const base = normalizeHttpUrl(baseUrl, baseUrl);
  const url = normalizeHttpUrl(value, base.href);
  if (url.origin !== base.origin) return false;
  const root = crawlBasePath(base.href);
  const targetPath = url.pathname.replace(/\/$/, "") || "/";
  if (!(targetPath === root || targetPath.startsWith(root === "/" ? "/" : `${root}/`))) return false;
  return !/\.(?:avif|bmp|css|csv|docx?|eot|gif|ico|jpe?g|js|json|map|mp3|mp4|mpeg|mov|pdf|png|pptx?|rar|svg|tar|tiff?|txt|wav|webm|webp|woff2?|xlsx?|xml|zip)$/i.test(targetPath);
}

export function safeArtifactBaseName(title) {
  return String(title || "captured-page")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "captured-page";
}

export function redactUrl(value) {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}
