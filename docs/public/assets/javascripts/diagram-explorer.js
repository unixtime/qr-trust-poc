(function () {
  "use strict";

  const SELECTOR = ".mermaid";
  const ENHANCED_ATTRIBUTE = "data-diagram-explorer";
  const MIN_SCALE = 0.25;
  const MAX_SCALE = 5;
  const SCALE_STEP = 1.2;

  let dialog;
  let dialogTitle;
  let stage;
  let canvas;
  let zoomLabel;
  let activeTrigger;
  let naturalWidth = 1;
  let naturalHeight = 1;
  let fitScale = 1;
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  let dragState = null;

  function element(tagName, className, text) {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function button(className, label, text) {
    const node = element("button", className, text);
    node.type = "button";
    node.setAttribute("aria-label", label);
    return node;
  }

  function nearestHeading(diagram) {
    function headingText(heading) {
      const copy = heading.cloneNode(true);
      copy.querySelectorAll(".headerlink").forEach(function (link) {
        link.remove();
      });
      return copy.textContent.trim();
    }

    let node = diagram;

    while (node) {
      let sibling = node.previousElementSibling;
      while (sibling) {
        if (/^H[2-4]$/.test(sibling.tagName)) {
          return headingText(sibling);
        }
        const nestedHeading = sibling.querySelector("h2, h3, h4");
        if (nestedHeading) return headingText(nestedHeading);
        sibling = sibling.previousElementSibling;
      }
      node = node.parentElement;
      if (node && node.matches("main, article, body")) break;
    }

    return "Architecture diagram";
  }

  function iconPath(svg, pathData) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    svg.appendChild(path);
  }

  function addIcon(target, name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "18");
    svg.setAttribute("height", "18");

    const icons = {
      close: "M6 6l12 12M18 6L6 18",
      expand: "M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5",
      minus: "M5 12h14",
      plus: "M12 5v14M5 12h14",
      fit: "M8 4H4v4M16 4h4v4M8 20H4v-4M16 20h4v-4",
    };

    iconPath(svg, icons[name]);
    target.prepend(svg);
  }

  function ensureDialog() {
    if (dialog) return dialog;

    dialog = element("dialog", "qr-diagram-dialog");
    dialog.setAttribute("aria-labelledby", "qr-diagram-dialog-title");

    const shell = element("div", "qr-diagram-dialog__shell");
    const header = element("header", "qr-diagram-dialog__header");
    const headingGroup = element("div", "qr-diagram-dialog__heading");
    const eyebrow = element("span", "qr-diagram-dialog__eyebrow", "Interactive diagram");
    dialogTitle = element("h2", "qr-diagram-dialog__title");
    dialogTitle.id = "qr-diagram-dialog-title";
    headingGroup.append(eyebrow, dialogTitle);

    const controls = element("div", "qr-diagram-dialog__controls");
    controls.setAttribute("aria-label", "Diagram zoom controls");

    const zoomOut = button("qr-diagram-control", "Zoom out", "Zoom out");
    addIcon(zoomOut, "minus");

    zoomLabel = element("output", "qr-diagram-dialog__zoom", "100%");
    zoomLabel.setAttribute("aria-live", "polite");
    zoomLabel.setAttribute("aria-label", "Current zoom");

    const zoomIn = button("qr-diagram-control", "Zoom in", "Zoom in");
    addIcon(zoomIn, "plus");

    const fit = button("qr-diagram-control qr-diagram-control--fit", "Fit diagram to window", "Fit");
    addIcon(fit, "fit");

    const close = button("qr-diagram-control qr-diagram-control--close", "Close diagram", "Close");
    addIcon(close, "close");

    controls.append(zoomOut, zoomLabel, zoomIn, fit, close);
    header.append(headingGroup, controls);

    stage = element("div", "qr-diagram-stage");
    stage.tabIndex = 0;
    stage.setAttribute("aria-label", "Zoomable diagram. Use the mouse wheel or plus and minus keys to zoom. Drag to pan.");
    canvas = element("div", "qr-diagram-canvas");
    stage.appendChild(canvas);

    const footer = element("footer", "qr-diagram-dialog__footer");
    footer.append(
      element("span", "qr-diagram-dialog__instruction", "Scroll to zoom"),
      element("span", "qr-diagram-dialog__instruction", "Drag to pan"),
      element("span", "qr-diagram-dialog__instruction", "0 fits · 1 shows 100% · Esc closes")
    );

    shell.append(header, stage, footer);
    dialog.appendChild(shell);
    document.body.appendChild(dialog);

    zoomOut.addEventListener("click", function () {
      zoomBy(1 / SCALE_STEP);
    });
    zoomIn.addEventListener("click", function () {
      zoomBy(SCALE_STEP);
    });
    fit.addEventListener("click", fitDiagram);
    close.addEventListener("click", function () {
      dialog.close();
    });

    stage.addEventListener("wheel", onWheel, { passive: false });
    stage.addEventListener("pointerdown", onPointerDown);
    stage.addEventListener("pointermove", onPointerMove);
    stage.addEventListener("pointerup", endDrag);
    stage.addEventListener("pointercancel", endDrag);
    dialog.addEventListener("keydown", onDialogKeydown);
    dialog.addEventListener("close", onDialogClose);

    return dialog;
  }

  function dimensions(svg) {
    const viewBox = svg.viewBox && svg.viewBox.baseVal;
    if (viewBox && viewBox.width > 0 && viewBox.height > 0) {
      return { width: viewBox.width, height: viewBox.height };
    }

    const box = svg.getBoundingClientRect();
    return {
      width: Math.max(box.width, 1),
      height: Math.max(box.height, 1),
    };
  }

  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }

  function renderTransform() {
    canvas.style.transform =
      "translate(-50%, -50%) translate3d(" +
      offsetX +
      "px, " +
      offsetY +
      "px, 0) scale(" +
      scale +
      ")";
    zoomLabel.textContent = Math.round(scale * 100) + "%";
  }

  function fitDiagram() {
    const bounds = stage.getBoundingClientRect();
    const horizontalSpace = Math.max(bounds.width - 96, 120);
    const verticalSpace = Math.max(bounds.height - 96, 120);
    fitScale = clamp(
      Math.min(horizontalSpace / naturalWidth, verticalSpace / naturalHeight),
      MIN_SCALE,
      MAX_SCALE
    );
    scale = fitScale;
    offsetX = 0;
    offsetY = 0;
    renderTransform();
  }

  function setActualSize() {
    scale = clamp(1, MIN_SCALE, MAX_SCALE);
    offsetX = 0;
    offsetY = 0;
    renderTransform();
  }

  function setScale(nextScale, focalX, focalY) {
    const previousScale = scale;
    const boundedScale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
    if (boundedScale === previousScale) return;

    if (typeof focalX === "number" && typeof focalY === "number") {
      const ratio = boundedScale / previousScale;
      offsetX = focalX - (focalX - offsetX) * ratio;
      offsetY = focalY - (focalY - offsetY) * ratio;
    }

    scale = boundedScale;
    renderTransform();
  }

  function zoomBy(factor) {
    setScale(scale * factor, 0, 0);
  }

  function onWheel(event) {
    event.preventDefault();
    const bounds = stage.getBoundingClientRect();
    const focalX = event.clientX - bounds.left - bounds.width / 2;
    const focalY = event.clientY - bounds.top - bounds.height / 2;
    setScale(scale * (event.deltaY < 0 ? 1.12 : 1 / 1.12), focalX, focalY);
  }

  function onPointerDown(event) {
    if (event.button !== 0) return;
    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: offsetX,
      offsetY: offsetY,
    };
    stage.setPointerCapture(event.pointerId);
    stage.classList.add("is-dragging");
  }

  function onPointerMove(event) {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    offsetX = dragState.offsetX + event.clientX - dragState.startX;
    offsetY = dragState.offsetY + event.clientY - dragState.startY;
    renderTransform();
  }

  function endDrag(event) {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    if (stage.hasPointerCapture(event.pointerId)) {
      stage.releasePointerCapture(event.pointerId);
    }
    dragState = null;
    stage.classList.remove("is-dragging");
  }

  function onDialogKeydown(event) {
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomBy(SCALE_STEP);
    } else if (event.key === "-") {
      event.preventDefault();
      zoomBy(1 / SCALE_STEP);
    } else if (event.key === "0") {
      event.preventDefault();
      fitDiagram();
    } else if (event.key === "1") {
      event.preventDefault();
      setActualSize();
    }
  }

  function onDialogClose() {
    canvas.replaceChildren();
    dragState = null;
    if (activeTrigger) activeTrigger.focus();
    activeTrigger = null;
  }

  function openDiagram(diagram, trigger) {
    const source = diagram.querySelector("svg");
    if (!source) return;

    ensureDialog();
    activeTrigger = trigger;
    dialogTitle.textContent = nearestHeading(diagram);

    const clone = source.cloneNode(true);
    const size = dimensions(source);
    naturalWidth = size.width;
    naturalHeight = size.height;
    clone.removeAttribute("style");
    clone.setAttribute("width", String(naturalWidth));
    clone.setAttribute("height", String(naturalHeight));
    clone.setAttribute("preserveAspectRatio", "xMidYMid meet");
    clone.setAttribute("focusable", "false");
    clone.setAttribute("aria-hidden", "true");
    canvas.replaceChildren(clone);

    dialog.showModal();
    requestAnimationFrame(function () {
      fitDiagram();
      stage.focus();
    });
  }

  function enhance(diagram) {
    if (diagram.hasAttribute(ENHANCED_ATTRIBUTE) || !diagram.querySelector("svg")) return;
    diagram.setAttribute(ENHANCED_ATTRIBUTE, "true");

    const title = nearestHeading(diagram);
    const card = element("section", "qr-diagram-card");
    card.setAttribute("aria-label", title + " diagram");
    const renderedSize = dimensions(diagram.querySelector("svg"));
    if (renderedSize.width / renderedSize.height > 2.1) {
      card.classList.add("qr-diagram-card--wide");
    }

    const toolbar = element("div", "qr-diagram-card__toolbar");
    const labelGroup = element("div", "qr-diagram-card__label-group");
    labelGroup.append(
      element("span", "qr-diagram-card__eyebrow", "Diagram"),
      element("span", "qr-diagram-card__title", title)
    );

    const open = button("qr-diagram-open", "Open " + title + " in interactive view", "Open interactive view");
    addIcon(open, "expand");
    toolbar.append(labelGroup, open);

    const footer = element("div", "qr-diagram-card__footer");
    footer.append(
      element("span", "qr-diagram-card__hint", "Select the diagram to inspect it"),
      element("span", "qr-diagram-card__hint qr-diagram-card__hint--wide", "Modal supports zoom, pan, and keyboard controls")
    );

    diagram.parentNode.insertBefore(card, diagram);
    card.append(toolbar, diagram, footer);
    diagram.tabIndex = 0;
    diagram.setAttribute("role", "button");
    diagram.setAttribute("aria-label", "Open " + title + " in interactive view");

    open.addEventListener("click", function () {
      openDiagram(diagram, open);
    });
    diagram.addEventListener("click", function () {
      openDiagram(diagram, diagram);
    });
    diagram.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openDiagram(diagram, diagram);
      }
    });
  }

  function enhanceRenderedDiagrams(root) {
    if (root instanceof Element) {
      const diagram = root.matches(SELECTOR) ? root : root.closest(SELECTOR);
      if (diagram) enhance(diagram);
    }
    root.querySelectorAll(SELECTOR).forEach(enhance);
  }

  function start() {
    enhanceRenderedDiagrams(document);

    const observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        mutation.addedNodes.forEach(function (node) {
          if (node instanceof Element) enhanceRenderedDiagrams(node);
        });
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
