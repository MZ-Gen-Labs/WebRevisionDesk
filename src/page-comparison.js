function normalizeSpace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function hash(value) {
  let result = 2166136261;
  for (const character of String(value)) {
    result ^= character.codePointAt(0);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function snapshot(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, noscript, meta[http-equiv='refresh' i]").forEach((element) => element.remove());
  doc.querySelectorAll("[data-web-revision-id]").forEach((element) => element.removeAttribute("data-web-revision-id"));
  doc.querySelectorAll(".web-revision-selected").forEach((element) => element.classList.remove("web-revision-selected"));
  const text = normalizeSpace(doc.body?.textContent);
  const links = [...doc.querySelectorAll("a")].map((link) => `${normalizeSpace(link.textContent)}|${link.getAttribute("href") || ""}`);
  const images = [...doc.querySelectorAll("img")].map((image) => `${hash(image.getAttribute("src") || "")}|${image.getAttribute("alt") || ""}`);
  const structure = [...doc.body.querySelectorAll("*")].map((element) => [
    element.tagName,
    element.id,
    [...element.classList].sort().join("."),
    element.getAttribute("role") || "",
  ].join("|"));
  const styles = [...doc.querySelectorAll("style")].map((style) => style.textContent || "").join("\n");
  return { text, links, images, structure, styleHash: hash(styles) };
}

export function comparePageHtml(previousHtml, currentHtml) {
  const previous = snapshot(previousHtml);
  const current = snapshot(currentHtml);
  const fields = {
    text: previous.text !== current.text,
    links: JSON.stringify(previous.links) !== JSON.stringify(current.links),
    images: JSON.stringify(previous.images) !== JSON.stringify(current.images),
    structure: JSON.stringify(previous.structure) !== JSON.stringify(current.structure),
    styles: previous.styleHash !== current.styleHash,
  };
  const changedKinds = Object.entries(fields).filter(([, changed]) => changed).map(([name]) => name);
  return {
    changed: changedKinds.length > 0,
    changedKinds,
    fields,
    previous: { textLength: previous.text.length, linkCount: previous.links.length, imageCount: previous.images.length, elementCount: previous.structure.length },
    current: { textLength: current.text.length, linkCount: current.links.length, imageCount: current.images.length, elementCount: current.structure.length },
  };
}
