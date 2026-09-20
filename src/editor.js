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
    this.selectedElements = new Set();
    this.selectionAnchor = null;
    this.editable = false;
    this.loaded = false;
    this.editingSnapshot = null;
    this.nextElementId = 1;
    this.elementClipboard = [];
    this.selectionNavigation = [];
    this.inlineLinkSelection = null;
  }

  load(html, editable) {
    this.editable = editable;
    this.selected = null;
    this.selectedElements = new Set();
    this.selectionAnchor = null;
    this.selectionNavigation = [];
    this.inlineLinkSelection = null;
    this.callbacks.onTextSelection?.(null);
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
      if (element.closest('[contenteditable="true"]')) return;
      event.preventDefault();
      event.stopPropagation();
      this.select(element, {
        additive: event.ctrlKey || event.metaKey,
        range: event.shiftKey,
      });
    }, true);

    const captureTextSelection = () => queueMicrotask(() => this.#captureInlineLinkSelection());
    doc.addEventListener("mouseup", captureTextSelection);
    doc.addEventListener("keyup", captureTextSelection);

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
        this.#notifySelection();
      }
    }, true);
  }

  #notifySelection() {
    this.callbacks.onSelect?.(this.selected, [...this.selectedElements]);
  }

  #clearInlineLinkSelection() {
    this.inlineLinkSelection = null;
    this.callbacks.onTextSelection?.(null);
  }

  #captureInlineLinkSelection() {
    const doc = this.getDocument();
    const selection = doc?.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !selection.toString().trim()) {
      this.#clearInlineLinkSelection();
      return;
    }
    const range = selection.getRangeAt(0);
    const startElement = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    const endElement = range.endContainer.nodeType === 1 ? range.endContainer : range.endContainer.parentElement;
    if (!startElement || !endElement || !doc.body.contains(startElement) || !doc.body.contains(endElement)) {
      this.#clearInlineLinkSelection();
      return;
    }
    const commonNode = range.commonAncestorContainer;
    const commonElement = commonNode.nodeType === 1 ? commonNode : commonNode.parentElement;
    let container = this.selected?.contains(startElement) && this.selected.contains(endElement)
      ? this.selected
      : commonElement;
    if (container?.tagName === "A") container = container.parentElement;
    if (!container || STRUCTURE_ELEMENTS.has(container.tagName)) {
      this.#clearInlineLinkSelection();
      return;
    }
    const startLink = startElement.closest("a");
    const endLink = endElement.closest("a");
    const link = startLink && startLink === endLink ? startLink : null;
    this.inlineLinkSelection = { range: range.cloneRange(), container, link };
    this.callbacks.onTextSelection?.({
      text: selection.toString(),
      href: link?.getAttribute("href") || "",
      linked: Boolean(link),
    });
  }

  #replaceSelection(elements, primary = elements.at(-1) ?? null) {
    this.selectedElements.forEach((selected) => selected.classList.remove(EDITOR_CLASS));
    this.selectedElements = new Set(elements.filter((element) => element?.isConnected));
    this.selectedElements.forEach((selected) => selected.classList.add(EDITOR_CLASS));
    this.selected = this.selectedElements.has(primary) ? primary : [...this.selectedElements].at(-1) ?? null;
    this.#notifySelection();
  }

  select(element, { additive = false, range = false, preserveNavigation = false } = {}) {
    if (!preserveNavigation) this.selectionNavigation = [];
    this.#clearInlineLinkSelection();
    if (!element) return this.clearSelection();
    if (range && this.selectionAnchor?.isConnected && this.selectionAnchor.parentElement === element.parentElement) {
      const siblings = [...element.parentElement.children];
      const start = siblings.indexOf(this.selectionAnchor);
      const end = siblings.indexOf(element);
      const ranged = siblings.slice(Math.min(start, end), Math.max(start, end) + 1);
      const elements = additive ? [...new Set([...this.selectedElements, ...ranged])] : ranged;
      this.#replaceSelection(elements, element);
      return;
    }
    if (additive) {
      const elements = new Set(this.selectedElements);
      if (elements.has(element)) elements.delete(element);
      else elements.add(element);
      this.selectionAnchor = element;
      this.#replaceSelection([...elements], elements.has(element) ? element : [...elements].at(-1));
      return;
    }
    this.selectionAnchor = element;
    this.#replaceSelection([element], element);
  }

  clearSelection() {
    this.selectedElements.forEach((element) => {
      element.classList.remove(EDITOR_CLASS);
      element.removeAttribute("contenteditable");
    });
    this.selectedElements.clear();
    this.selected = null;
    this.selectionAnchor = null;
    this.selectionNavigation = [];
    this.#clearInlineLinkSelection();
    this.#notifySelection();
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

  getSelectionCount() {
    return this.selectedElements.size;
  }

  hasClipboard() {
    return this.elementClipboard.length > 0;
  }

  canCopySelection() {
    return [...this.selectedElements].some((element) => !STRUCTURE_ELEMENTS.has(element.tagName));
  }

  copySelected() {
    const copied = [...this.selectedElements]
      .filter((element) => !STRUCTURE_ELEMENTS.has(element.tagName))
      .filter((element, _index, elements) => !elements.some((other) => other !== element && other.contains(element)))
      .map((element) => this.#cleanOuterHtml(element));
    if (!copied.length) return 0;
    this.elementClipboard = copied;
    return copied.length;
  }

  canPaste() {
    return this.hasClipboard()
      && this.selectedElements.size === 1
      && Boolean(this.selected?.parentElement)
      && !STRUCTURE_ELEMENTS.has(this.selected.tagName);
  }

  pasteBefore() {
    return this.#paste("before");
  }

  pasteAfter() {
    return this.#paste("after");
  }

  canSelectParent() {
    return this.selectedElements.size === 1
      && Boolean(this.selected?.parentElement)
      && this.selected.parentElement.tagName !== "HTML";
  }

  selectParent() {
    if (!this.canSelectParent()) return false;
    this.selectionNavigation.push(this.selected);
    this.select(this.selected.parentElement, { preserveNavigation: true });
    return true;
  }

  canReturnToChild() {
    return this.selectedElements.size === 1
      && this.selectionNavigation.some((element) => element?.isConnected);
  }

  returnToChild() {
    while (this.selectionNavigation.length) {
      const child = this.selectionNavigation.pop();
      if (!child?.isConnected) continue;
      this.select(child, { preserveNavigation: true });
      return true;
    }
    return false;
  }

  #paste(position) {
    if (!this.canPaste()) return 0;
    const target = this.selected;
    const parent = target.parentElement;
    const reference = position === "before" ? target : target.nextElementSibling;
    const pasted = this.elementClipboard
      .map((html) => this.#elementFromHtml(html))
      .filter(Boolean);
    if (!pasted.length) return 0;
    pasted.forEach((element) => {
      this.#assignNewIds(element);
      parent.insertBefore(element, reference);
    });
    const changes = pasted.map((element) => ({
      type: "element-add",
      target: this.#describe(element),
      elementId: this.#ensureElementId(element),
      parentId: this.#ensureElementId(parent),
      index: [...parent.children].indexOf(element),
      before: "",
      after: this.#cleanOuterHtml(element),
      action: "paste",
      timestamp: new Date().toISOString(),
    }));
    this.#replaceSelection(pasted, pasted.at(-1));
    changes.forEach((change) => this.callbacks.onChange?.(change));
    return pasted.length;
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

  hasInlineLinkSelection() {
    return Boolean(this.inlineLinkSelection?.range && this.inlineLinkSelection.container?.isConnected);
  }

  applyInlineLink(value) {
    const context = this.inlineLinkSelection;
    const href = value.trim();
    if (!href || !this.hasInlineLinkSelection()) return false;
    const { range, container, link } = context;
    const selectedText = range.toString();
    const beforeHtml = container.innerHTML;
    const before = link?.getAttribute("href") || "";
    if (link) {
      link.setAttribute("href", href);
    } else {
      const doc = this.getDocument();
      const wrapper = doc.createElement("a");
      wrapper.setAttribute("href", href);
      const fragment = range.extractContents();
      fragment.querySelectorAll?.("a").forEach((nestedLink) => nestedLink.replaceWith(...nestedLink.childNodes));
      wrapper.append(fragment);
      range.insertNode(wrapper);
      this.#ensureElementId(wrapper);
    }
    this.#emitChange("inline-link-change", container, before, href, {
      beforeHtml,
      afterHtml: container.innerHTML,
      selectedText,
    });
    this.select(container);
    return true;
  }

  removeInlineLink() {
    const context = this.inlineLinkSelection;
    if (!context?.link || !this.hasInlineLinkSelection()) return false;
    const { container, link } = context;
    const beforeHtml = container.innerHTML;
    const before = link.getAttribute("href") || "";
    link.replaceWith(...link.childNodes);
    this.#emitChange("inline-link-change", container, before, "", {
      beforeHtml,
      afterHtml: container.innerHTML,
      selectedText: context.range.toString(),
    });
    this.select(container);
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
    const parentOrderBefore = [...parent.children].map((element) => this.#ensureElementId(element));
    const fromIndex = [...parent.children].indexOf(this.selected);
    const before = `直前: ${this.#describe(previous)}`;
    this.selected.parentElement.insertBefore(this.selected, previous);
    const toIndex = [...parent.children].indexOf(this.selected);
    const after = this.selected.nextElementSibling ? `直後: ${this.#describe(this.selected.nextElementSibling)}` : "先頭へ移動";
    this.#emitChange("element-move", this.selected, before, after, {
      parentId: this.#ensureElementId(parent), fromIndex, toIndex,
      parentOrderBefore,
      parentOrderAfter: [...parent.children].map((element) => this.#ensureElementId(element)),
    });
    return true;
  }

  moveAfter() {
    const next = this.selected?.nextElementSibling;
    if (!this.selected || !next || STRUCTURE_ELEMENTS.has(this.selected.tagName)) return false;
    const parent = this.selected.parentElement;
    const parentOrderBefore = [...parent.children].map((element) => this.#ensureElementId(element));
    const fromIndex = [...parent.children].indexOf(this.selected);
    const before = `直後: ${this.#describe(next)}`;
    next.after(this.selected);
    const toIndex = [...parent.children].indexOf(this.selected);
    const after = this.selected.previousElementSibling ? `直前: ${this.#describe(this.selected.previousElementSibling)}` : "末尾へ移動";
    this.#emitChange("element-move", this.selected, before, after, {
      parentId: this.#ensureElementId(parent), fromIndex, toIndex,
      parentOrderBefore,
      parentOrderAfter: [...parent.children].map((element) => this.#ensureElementId(element)),
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
    const removedElements = [...this.selectedElements]
      .filter((element) => !STRUCTURE_ELEMENTS.has(element.tagName))
      .filter((element, _index, elements) => !elements.some((other) => other !== element && other.contains(element)))
      .sort((left, right) => {
        const position = left.compareDocumentPosition(right);
        return position & left.ownerDocument.defaultView.Node.DOCUMENT_POSITION_FOLLOWING ? 1 : -1;
      });
    if (!removedElements.length) return false;
    const changes = removedElements.map((removed) => ({
      type: "element-delete",
      target: this.#describe(removed),
      elementId: this.#ensureElementId(removed),
      removedElementIds: [removed, ...removed.querySelectorAll("*")].map((element) => this.#ensureElementId(element)),
      parentId: removed.parentElement ? this.#ensureElementId(removed.parentElement) : "",
      index: removed.parentElement ? [...removed.parentElement.children].indexOf(removed) : -1,
      before: this.#cleanOuterHtml(removed),
      after: "",
      timestamp: new Date().toISOString(),
    }));
    this.selectedElements.forEach((element) => element.classList.remove(EDITOR_CLASS));
    this.selectedElements.clear();
    this.selected = null;
    this.selectionAnchor = null;
    removedElements.forEach((element) => element.remove());
    this.#notifySelection();
    changes.forEach((change) => this.callbacks.onChange?.(change));
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
    } else if (change.type === "text-change" || change.type === "inline-link-change") {
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
