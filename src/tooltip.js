/**
 * Custom tooltip implementation for Web Revision Desk.
 * Displays immediate, elegant tooltips even for disabled buttons and controls,
 * avoiding the browser's native delayed title tooltips.
 */

let tooltipElement = null;
let currentTarget = null;
let showTimer = null;
let isVisible = false;
let lastPointerX = null;
let lastPointerY = null;

function getTooltipText(element) {
  if (!element || typeof element.getAttribute !== "function") return "";
  let directText = element.dataset?.tooltip || element.getAttribute?.("title") || "";
  if (element.hasAttribute?.("title")) {
    element.dataset.tooltip = element.getAttribute("title");
    element.removeAttribute("title");
    directText = element.dataset.tooltip;
  }
  if (directText.trim()) return directText.trim();
  const parent = element.closest?.("[data-tooltip], [title]");
  if (parent && parent !== element) {
    let parentText = parent.dataset?.tooltip || parent.getAttribute?.("title") || "";
    if (parent.hasAttribute?.("title")) {
      parent.dataset.tooltip = parent.getAttribute("title");
      parent.removeAttribute("title");
      parentText = parent.dataset.tooltip;
    }
    return parentText.trim();
  }
  return "";
}

function findTooltipTarget(x, y) {
  if (typeof document.elementsFromPoint !== "function") return null;
  const elements = document.elementsFromPoint(x, y);
  for (const el of elements) {
    if (el === tooltipElement) continue;
    const text = getTooltipText(el);
    if (text) {
      return el.dataset.tooltip || el.getAttribute("title") ? el : el.closest("[data-tooltip], [title]");
    }
  }
  return null;
}

function createTooltipElement(targetDoc = document) {
  const doc = targetDoc?.ownerDocument || targetDoc || document;
  if (tooltipElement && tooltipElement.ownerDocument === doc && tooltipElement.isConnected) return tooltipElement;
  tooltipElement = doc.getElementById?.("app-tooltip");
  if (tooltipElement) return tooltipElement;
  tooltipElement = doc.createElement("div");
  tooltipElement.id = "app-tooltip";
  tooltipElement.className = "app-tooltip";
  tooltipElement.setAttribute("role", "tooltip");
  tooltipElement.hidden = true;
  doc.body?.appendChild(tooltipElement);
  return tooltipElement;
}

export function positionTooltip(target, pointerX = lastPointerX, pointerY = lastPointerY) {
  if (!target) return;
  createTooltipElement(target.ownerDocument || document);
  if (!tooltipElement) return;

  const targetRect = target.getBoundingClientRect();
  const tooltipRect = tooltipElement.getBoundingClientRect();
  const topGap = 8;
  const sideGap = 10;
  const bottomGap = 16;
  const padding = 8;
  const winHeight = window.innerHeight || 800;
  const winWidth = window.innerWidth || 1200;

  // Check available space in all 4 directions
  const roomAbove = targetRect.top - tooltipRect.height - topGap;
  const roomBelow = winHeight - targetRect.bottom - tooltipRect.height - bottomGap;
  const roomLeft = targetRect.left - tooltipRect.width - sideGap;
  const roomRight = winWidth - targetRect.right - tooltipRect.width - sideGap;

  const canFitAbove = roomAbove >= padding;
  const canFitLeft = roomLeft >= padding;
  const canFitRight = roomRight >= padding;

  let left;
  let top;

  if (canFitAbove) {
    // 1. Primary choice: ABOVE target.
    // Completely eliminates cursor overlap because mouse cursor is inside/below target and points downwards.
    top = targetRect.top - tooltipRect.height - topGap;
    left = targetRect.left + (targetRect.width - tooltipRect.width) / 2;
    left = Math.max(padding, Math.min(winWidth - tooltipRect.width - padding, left));
    tooltipElement.dataset.placement = "top";
  } else if (canFitLeft || canFitRight) {
    // 2. Secondary choice: LEFT or RIGHT side when above is constrained (e.g. topbar buttons).
    // Vertically center with target button
    top = targetRect.top + (targetRect.height - tooltipRect.height) / 2;
    top = Math.max(padding, Math.min(winHeight - tooltipRect.height - padding, top));

    // Choose side with more room if both fit, otherwise whichever fits
    const placeLeft = (canFitLeft && canFitRight) ? (roomLeft >= roomRight) : canFitLeft;

    if (placeLeft) {
      left = targetRect.left - tooltipRect.width - sideGap;
      tooltipElement.dataset.placement = "left";
    } else {
      const cursorClearance = pointerX != null ? pointerX + 20 : targetRect.right + sideGap;
      left = Math.max(targetRect.right + sideGap, cursorClearance);
      left = Math.min(left, winWidth - tooltipRect.width - padding);
      tooltipElement.dataset.placement = "right";
    }
  } else {
    // 3. Fallback: Whichever side has maximum space
    const maxSpace = Math.max(roomAbove, roomBelow, roomLeft, roomRight);
    if (maxSpace === roomLeft) {
      top = Math.max(padding, Math.min(winHeight - tooltipRect.height - padding, targetRect.top + (targetRect.height - tooltipRect.height) / 2));
      left = Math.max(padding, targetRect.left - tooltipRect.width - sideGap);
      tooltipElement.dataset.placement = "left";
    } else if (maxSpace === roomRight) {
      top = Math.max(padding, Math.min(winHeight - tooltipRect.height - padding, targetRect.top + (targetRect.height - tooltipRect.height) / 2));
      left = Math.min(winWidth - tooltipRect.width - padding, targetRect.right + sideGap);
      tooltipElement.dataset.placement = "right";
    } else if (maxSpace === roomAbove) {
      top = Math.max(padding, targetRect.top - tooltipRect.height - topGap);
      left = Math.max(padding, Math.min(winWidth - tooltipRect.width - padding, targetRect.left + (targetRect.width - tooltipRect.width) / 2));
      tooltipElement.dataset.placement = "top";
    } else {
      const cursorClearance = pointerY != null ? pointerY + 26 : targetRect.bottom + bottomGap;
      top = Math.max(targetRect.bottom + bottomGap, cursorClearance);
      top = Math.min(top, winHeight - tooltipRect.height - padding);
      left = Math.max(padding, Math.min(winWidth - tooltipRect.width - padding, targetRect.left + (targetRect.width - tooltipRect.width) / 2));
      tooltipElement.dataset.placement = "bottom";
    }
  }

  tooltipElement.style.left = `${Math.round(left)}px`;
  tooltipElement.style.top = `${Math.round(top)}px`;
}

function showTooltip(target, text, immediate = false, pointerX = lastPointerX, pointerY = lastPointerY) {
  if (!target || !text) return;
  clearTimeout(showTimer);

  const display = () => {
    createTooltipElement(target.ownerDocument || document);
    tooltipElement.textContent = text;
    tooltipElement.hidden = false;
    positionTooltip(target, pointerX, pointerY);
    isVisible = true;
  };

  if (immediate || isVisible) {
    display();
  } else {
    showTimer = setTimeout(display, 120);
  }
}

function hideTooltip() {
  clearTimeout(showTimer);
  if (tooltipElement) {
    tooltipElement.hidden = true;
  }
  currentTarget = null;
  isVisible = false;
}

export function initTooltips(root = document) {
  createTooltipElement(root);

  // Convert existing title attributes on buttons/controls to data-tooltip so native delayed tooltips don't appear
  const elementsWithTitle = root.querySelectorAll?.("[title]") || [];
  for (const el of elementsWithTitle) {
    const titleText = el.getAttribute("title");
    if (titleText) {
      el.dataset.tooltip = titleText;
      el.removeAttribute("title");
    }
  }

  // Use pointermove with elementsFromPoint so disabled buttons are detected accurately
  document.addEventListener("pointermove", (event) => {
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;

    const target = findTooltipTarget(event.clientX, event.clientY);
    if (!target) {
      if (currentTarget) hideTooltip();
      return;
    }

    if (target !== currentTarget) {
      const text = getTooltipText(target);
      if (text) {
        const switchImmediate = isVisible;
        currentTarget = target;
        showTooltip(target, text, switchImmediate, event.clientX, event.clientY);
      } else {
        hideTooltip();
      }
    } else if (isVisible && tooltipElement?.dataset.placement === "bottom") {
      const currentTop = parseFloat(tooltipElement.style.top) || 0;
      const neededTop = event.clientY + 26;
      if (neededTop > currentTop) {
        positionTooltip(target, event.clientX, event.clientY);
      }
    } else if (isVisible && tooltipElement?.dataset.placement === "right") {
      const currentLeft = parseFloat(tooltipElement.style.left) || 0;
      const neededLeft = event.clientX + 20;
      if (neededLeft > currentLeft) {
        positionTooltip(target, event.clientX, event.clientY);
      }
    }
  }, { passive: true });

  document.addEventListener("pointerdown", hideTooltip, { passive: true });
  window.addEventListener("blur", hideTooltip);
  window.addEventListener("scroll", hideTooltip, { passive: true, capture: true });

  // Keyboard navigation support
  document.addEventListener("focusin", (event) => {
    const text = getTooltipText(event.target);
    if (text) {
      currentTarget = event.target;
      lastPointerX = null;
      lastPointerY = null;
      showTooltip(event.target, text, true, null, null);
    }
  });

  document.addEventListener("focusout", hideTooltip);
}
