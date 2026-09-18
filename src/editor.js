import {
  EDITOR_CLASS,
  EDITOR_ID_ATTR,
  EDITOR_STYLE_ID,
  collectClassNames,
  normalizeClasses,
  serializeDocument,
} from "./html.js";

const TEXT_BLOCKLIST = new Set([
  "HTML", "HEAD", "BODY", "SCRIPT", "STYLE", "LINK", "META", "IMG", "VIDEO", "AUDIO", "IFRAME", "CANVAS", "SVG",
]);
const STRUCTURE_ELEMENTS = new Set(["HTML", "HEAD", "BODY"]);

export class PageEditor {
  constructor(frame, callbacks = {}) {
    this.frame = frame;
    this.callbacks = callbacks;
    this.selected = null;
    this.editable = false;
    this.loaded = false;
    this.editingSnapshot = null;
    this.nextElementId = 1;
  }

  load(html, editable) {
    this.editable = editable;
    this.selected = null;
    this.loaded = false;
    return new Promise((resolve) => {
      const onLoad = () => {
        this.frame.removeEventListener("load", onLoad);
        this.#prepareDocument();
        this.loaded = true;
        resolve();
      };
      // srcdoc設定前からloadを待つと、iframe生成直後のabout:blankを
      // 読込完了と誤認するブラウザがあるため、設定後に登録する。
      this.frame.srcdoc = html;
      this.frame.addEventListener("load", onLoad);
    });
  }

  unload() {
    this.clearSelection();
    this.editable = false;
    this.loaded = false;
    this.editingSnapshot = null;
    this.frame.srcdoc = "";
  }

  #prepareDocument() {
    const doc = this.frame.contentDocument;
    if (!doc) return;
    const FrameElement = doc.defaultView?.Element;
    const FrameHTMLElement = doc.defaultView?.HTMLElement;
    this.#ensureElementIds(doc);
    doc.getElementById(EDITOR_STYLE_ID)?.remove();
    const style = doc.createElement("style");
    style.id = EDITOR_STYLE_ID;
    style.textContent = `
      .${EDITOR_CLASS} { outline: 3px solid #5b5bd6 !important; outline-offset: 2px !important; }
      [contenteditable="true"] { cursor: text !important; }
    `;
    doc.head?.append(style);

    doc.addEventListener("click", (event) => {
      const element = FrameElement && event.target instanceof FrameElement ? event.target : null;
      if (!element) return;
      const link = element.closest("a");
      if (link) event.preventDefault();
      if (!this.editable) return;
      event.preventDefault();
      event.stopPropagation();
      this.select(element);
    }, true);

    doc.addEventListener("dblclick", (event) => {
      if (!this.editable) return;
      const element = FrameHTMLElement && event.target instanceof FrameHTMLElement ? event.target : null;
      if (!element || TEXT_BLOCKLIST.has(element.tagName)) return;
      event.preventDefault();
      this.select(element);
      this.editingSnapshot = { element, before: element.textContent ?? "", beforeHtml: element.innerHTML };
      element.contentEditable = "true";
      element.focus();
    }, true);

    doc.addEventListener("focusout", (event) => {
      const element = FrameHTMLElement && event.target instanceof FrameHTMLElement ? event.target : null;
      if (element?.isContentEditable) {
        element.removeAttribute("contenteditable");
        const before = this.editingSnapshot?.element === element ? this.editingSnapshot.before : "";
        const after = element.textContent ?? "";
        const beforeHtml = this.editingSnapshot?.beforeHtml;
        this.editingSnapshot = null;
        if (before !== after || beforeHtml !== element.innerHTML) this.#emitChange("text-change", element, before, after, { beforeHtml, afterHtml: element.innerHTML });
        this.callbacks.onSelect?.(element);
      }
    }, true);
  }

  select(element) {
    this.selected?.classList.remove(EDITOR_CLASS);
    this.selected = element;
    this.selected.classList.add(EDITOR_CLASS);
    this.callbacks.onSelect?.(element);
  }

  clearSelection() {
    this.selected?.classList.remove(EDITOR_CLASS);
    this.selected?.removeAttribute("contenteditable");
    this.selected = null;
    this.callbacks.onSelect?.(null);
  }

  getDocument() {
    return this.frame.contentDocument;
  }

  getHtml() {
    if (!this.loaded || !this.getDocument()) return "";
    return serializeDocument(this.getDocument(), { keepEditorIds: true });
  }

  getExportHtml() {
    if (!this.loaded || !this.getDocument()) return "";
    return serializeDocument(this.getDocument());
  }

  hasLoadedDocument() {
    return this.loaded;
  }

  getClassNames() {
    return this.getDocument() ? collectClassNames(this.getDocument()) : [];
  }

  #ensureElementIds(doc) {
    let maxId = 0;
    doc.querySelectorAll("body, body *").forEach((element) => {
      const current = element.getAttribute(EDITOR_ID_ATTR);
      const numericId = current?.match(/^wr-(\d+)$/)?.[1];
      if (numericId) maxId = Math.max(maxId, Number(numericId));
    });
    this.nextElementId = maxId + 1;
    doc.querySelectorAll("body, body *").forEach((element) => this.#ensureElementId(element));
  }

  #ensureElementId(element) {
    if (!element.hasAttribute(EDITOR_ID_ATTR)) {
      element.setAttribute(EDITOR_ID_ATTR, `wr-${this.nextElementId++}`);
    }
    return element.getAttribute(EDITOR_ID_ATTR);
  }

  #assignNewIds(root) {
    [root, ...root.querySelectorAll("*")].forEach((element) => {
      element.setAttribute(EDITOR_ID_ATTR, `wr-${this.nextElementId++}`);
    });
  }

  #findByEditorId(id) {
    if (!id) return null;
    const escape = this.frame.contentWindow?.CSS?.escape ?? ((value) => String(value).replaceAll('"', '\\"'));
    return this.getDocument()?.querySelector(`[${EDITOR_ID_ATTR}="${escape(id)}"]`) ?? null;
  }

  #elementFromHtml(html) {
    const doc = this.getDocument();
    if (!doc || !html) return null;
    const template = doc.createElement("template");
    template.innerHTML = html;
    const element = template.content.firstElementChild;
    if (!element) return null;
    element.classList.remove(EDITOR_CLASS);
    element.removeAttribute("contenteditable");
    element.querySelectorAll?.(`.${EDITOR_CLASS}, [contenteditable]`).forEach((child) => {
      child.classList.remove(EDITOR_CLASS);
      child.removeAttribute("contenteditable");
    });
    return element;
  }

  #cleanOuterHtml(element) {
    const clone = element.cloneNode(true);
    clone.classList.remove(EDITOR_CLASS);
    clone.removeAttribute("contenteditable");
    clone.querySelectorAll?.(`.${EDITOR_CLASS}, [contenteditable]`).forEach((child) => {
      child.classList.remove(EDITOR_CLASS);
      child.removeAttribute("contenteditable");
    });
    return clone.outerHTML;
  }

  #describe(element) {
    const id = element.id ? `#${element.id}` : "";
    const classes = [...element.classList]
      .filter((name) => name !== EDITOR_CLASS)
      .slice(0, 2)
      .map((name) => `.${name}`)
      .join("");
    const text = (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 45);
    return `${element.tagName.toLowerCase()}${id}${classes}${text ? `「${text}」` : ""}`;
  }

  #emitChange(type, element, before, after, details = {}) {
    this.callbacks.onChange?.({
      type,
      target: this.#describe(element),
      elementId: this.#ensureElementId(element),
      before,
      after,
      timestamp: new Date().toISOString(),
      ...details,
    });
  }

  updateText(value) {
    if (!this.selected || TEXT_BLOCKLIST.has(this.selected.tagName)) return false;
    const before = this.selected.textContent ?? "";
    if (before === value) return false;
    const beforeHtml = this.selected.innerHTML;
    this.selected.textContent = value;
    this.#emitChange("text-change", this.selected, before, value, { beforeHtml, afterHtml: this.selected.innerHTML });
    return true;
  }

  updateLink(value) {
    const link = this.selected?.closest("a");
    if (!link) return false;
    const before = link.getAttribute("href") ?? "";
    const after = value.trim();
    if (before === after) return false;
    after ? link.setAttribute("href", after) : link.removeAttribute("href");
    this.#emitChange("link-change", link, before, after);
    return true;
  }

  updateAlt(value) {
    if (!(this.selected instanceof this.frame.contentWindow.HTMLImageElement)) return false;
    const before = this.selected.alt;
    if (before === value) return false;
    this.selected.alt = value;
    this.#emitChange("alt-change", this.selected, before, value);
    return true;
  }

  updateImage(dataUrl) {
    if (!(this.selected instanceof this.frame.contentWindow.HTMLImageElement)) return false;
    const before = this.selected.getAttribute("src") ?? "";
    if (before === dataUrl) return false;
    const beforeSrcset = this.selected.getAttribute("srcset") ?? "";
    this.selected.src = dataUrl;
    this.selected.removeAttribute("srcset");
    this.#emitChange("image-change", this.selected, before, dataUrl, {
      beforeAlt: this.selected.alt,
      afterAlt: this.selected.alt,
      beforeSrcset,
      afterSrcset: "",
    });
    return true;
  }

  updateClasses(value) {
    if (!this.selected) return false;
    const before = [...this.selected.classList].filter((name) => name !== EDITOR_CLASS).join(" ");
    const classes = normalizeClasses(value).filter((name) => name !== EDITOR_CLASS);
    const after = classes.join(" ");
    if (before === after) return false;
    this.selected.className = classes.join(" ");
    this.selected.classList.add(EDITOR_CLASS);
    this.#emitChange("class-change", this.selected, before, after);
    return true;
  }

  moveBefore() {
    const previous = this.selected?.previousElementSibling;
    if (!this.selected || !previous || STRUCTURE_ELEMENTS.has(this.selected.tagName)) return false;
    const parent = this.selected.parentElement;
    const fromIndex = [...parent.children].indexOf(this.selected);
    const before = `直前: ${this.#describe(previous)}`;
    this.selected.parentElement.insertBefore(this.selected, previous);
    const toIndex = [...parent.children].indexOf(this.selected);
    const after = this.selected.nextElementSibling ? `直後: ${this.#describe(this.selected.nextElementSibling)}` : "先頭へ移動";
    this.#emitChange("element-move", this.selected, before, after, {
      parentId: this.#ensureElementId(parent), fromIndex, toIndex,
    });
    return true;
  }

  moveAfter() {
    const next = this.selected?.nextElementSibling;
    if (!this.selected || !next || STRUCTURE_ELEMENTS.has(this.selected.tagName)) return false;
    const parent = this.selected.parentElement;
    const fromIndex = [...parent.children].indexOf(this.selected);
    const before = `直後: ${this.#describe(next)}`;
    next.after(this.selected);
    const toIndex = [...parent.children].indexOf(this.selected);
    const after = this.selected.previousElementSibling ? `直前: ${this.#describe(this.selected.previousElementSibling)}` : "末尾へ移動";
    this.#emitChange("element-move", this.selected, before, after, {
      parentId: this.#ensureElementId(parent), fromIndex, toIndex,
    });
    return true;
  }

  duplicateSelected() {
    if (!this.selected || STRUCTURE_ELEMENTS.has(this.selected.tagName)) return false;
    const source = this.selected;
    const clone = source.cloneNode(true);
    this.#assignNewIds(clone);
    clone.classList.remove(EDITOR_CLASS);
    clone.removeAttribute("contenteditable");
    clone.querySelectorAll?.(`.${EDITOR_CLASS}, [contenteditable]`).forEach((element) => {
      element.classList.remove(EDITOR_CLASS);
      element.removeAttribute("contenteditable");
    });
    source.after(clone);
    this.#emitChange("element-add", clone, "", clone.outerHTML, {
      action: "duplicate",
      parentId: this.#ensureElementId(clone.parentElement),
      index: [...clone.parentElement.children].indexOf(clone),
    });
    this.select(clone);
    return true;
  }

  deleteSelected() {
    if (!this.selected || STRUCTURE_ELEMENTS.has(this.selected.tagName)) return false;
    const removed = this.selected;
    const target = this.#describe(removed);
    const before = this.#cleanOuterHtml(removed);
    const elementId = this.#ensureElementId(removed);
    const parentId = removed.parentElement ? this.#ensureElementId(removed.parentElement) : "";
    const index = removed.parentElement ? [...removed.parentElement.children].indexOf(removed) : -1;
    this.selected = null;
    removed.remove();
    this.callbacks.onSelect?.(null);
    this.callbacks.onChange?.({
      type: "element-delete",
      target,
      elementId,
      parentId,
      index,
      before,
      after: "",
      timestamp: new Date().toISOString(),
    });
    return true;
  }

  applyChange(change, direction) {
    if (!change || !["undo", "redo"].includes(direction)) return false;
    const undo = direction === "undo";
    const value = undo ? change.before : change.after;
    let element = this.#findByEditorId(change.elementId);

    if (change.type === "element-add") {
      if (undo) {
        if (!element) return false;
        element.remove();
        this.clearSelection();
        return true;
      }
      const parent = this.#findByEditorId(change.parentId);
      element = this.#elementFromHtml(change.after);
      if (!parent || !element) return false;
      parent.insertBefore(element, parent.children[change.index] ?? null);
      this.select(element);
      return true;
    }

    if (change.type === "element-delete") {
      if (!undo) {
        if (!element) return false;
        element.remove();
        this.clearSelection();
        return true;
      }
      const parent = this.#findByEditorId(change.parentId);
      element = this.#elementFromHtml(change.before);
      if (!parent || !element) return false;
      parent.insertBefore(element, parent.children[change.index] ?? null);
      this.select(element);
      return true;
    }

    if (!element) return false;
    if (change.type === "element-move") {
      const parent = this.#findByEditorId(change.parentId) ?? element.parentElement;
      if (!parent) return false;
      const index = undo ? change.fromIndex : change.toIndex;
      element.remove();
      parent.insertBefore(element, parent.children[index] ?? null);
    } else if (change.type === "text-change") {
      const html = undo ? change.beforeHtml : change.afterHtml;
      if (typeof html === "string") element.innerHTML = html;
      else element.textContent = value;
    } else if (change.type === "link-change") {
      value ? element.setAttribute("href", value) : element.removeAttribute("href");
    } else if (change.type === "alt-change") {
      element.setAttribute("alt", value);
    } else if (change.type === "image-change") {
      element.setAttribute("src", value);
      const srcset = undo ? change.beforeSrcset : change.afterSrcset;
      srcset ? element.setAttribute("srcset", srcset) : element.removeAttribute("srcset");
    } else if (change.type === "class-change") {
      element.className = value;
    } else {
      return false;
    }
    this.select(element);
    return true;
  }
}
