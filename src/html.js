const EDITOR_CLASS = "web-revision-selected";
const EDITOR_STYLE_ID = "web-revision-editor-style";
const EDITOR_ID_ATTR = "data-web-revision-id";
const IMAGE_ASSET_NAME_ATTR = "data-web-revision-asset-name";

export function serializeDocument(doc, { keepEditorIds = false } = {}) {
  const clone = doc.documentElement.cloneNode(true);
  clone.querySelector(`#${EDITOR_STYLE_ID}`)?.remove();
  clone.querySelectorAll(`.${EDITOR_CLASS}`).forEach((element) => {
    element.classList.remove(EDITOR_CLASS);
    if (!element.classList.length) element.removeAttribute("class");
  });
  clone.querySelectorAll("[contenteditable]").forEach((element) => {
    element.removeAttribute("contenteditable");
  });
  if (!keepEditorIds) {
    clone.querySelectorAll(`[${EDITOR_ID_ATTR}]`).forEach((element) => {
      element.removeAttribute(EDITOR_ID_ATTR);
    });
  }

  const doctype = doc.doctype
    ? `<!DOCTYPE ${doc.doctype.name}${doc.doctype.publicId ? ` PUBLIC \"${doc.doctype.publicId}\"` : ""}${doc.doctype.systemId ? ` \"${doc.doctype.systemId}\"` : ""}>\n`
    : "<!doctype html>\n";
  return doctype + clone.outerHTML;
}

export function collectClassNames(doc) {
  const names = new Set();
  doc.querySelectorAll("[class]").forEach((element) => {
    element.classList.forEach((name) => {
      if (name !== EDITOR_CLASS) names.add(name);
    });
  });
  return [...names].sort((a, b) => a.localeCompare(b));
}

export function normalizeClasses(value) {
  return [...new Set(value.trim().split(/\s+/).filter(Boolean))];
}

export function downloadHtml(html, originalName) {
  const baseName = originalName.replace(/\.(html?|HTML?)$/, "") || "page";
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${baseName}-modified.html`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function cleanHtmlString(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return serializeDocument(doc);
}

export { EDITOR_CLASS, EDITOR_STYLE_ID, EDITOR_ID_ATTR, IMAGE_ASSET_NAME_ATTR };
