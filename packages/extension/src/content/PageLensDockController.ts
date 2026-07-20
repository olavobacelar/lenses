import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PageLensDock, type PageLensDockLensState } from "./PageLensDock.js";
import { shouldShowPageLensDock } from "./PageLensDockSettings.js";
import {
  createLensesShadowMount,
  removeLensesShadowHosts,
  type LensesShadowMount,
} from "./shadow-ui.js";
import type { LensResultDisplayMode } from "./types.js";

export const PAGE_LENS_DOCK_ROOT_CLASS = "lenses-page-dock-root";
const PAGE_DOCK_CRITICAL_STYLE_ID = "lenses-page-dock-critical-style";
const PAGE_DOCK_STYLE_WAIT_FRAME_LIMIT = 12;
const PAGE_DOCK_CRITICAL_CSS = `
  .${PAGE_LENS_DOCK_ROOT_CLASS} {
    position: fixed;
    top: 50%;
    right: 0;
    transform: translateY(-50%);
    z-index: 2147483647;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    pointer-events: none;
  }
  .${PAGE_LENS_DOCK_ROOT_CLASS} .lenses-page-dock {
    display: flex;
    align-items: center;
    gap: 8px;
    pointer-events: none;
  }
  .${PAGE_LENS_DOCK_ROOT_CLASS} .lenses-page-dock-rail {
    --lenses-page-dock-anchor-offset: 17px;
    display: flex;
    flex-direction: column;
    gap: 0;
    padding: 6px 3px 6px 4px;
    transition: transform 0.18s ease;
    pointer-events: none;
  }
  .${PAGE_LENS_DOCK_ROOT_CLASS} .lenses-page-dock-button {
    appearance: none;
    width: 30px;
    height: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 1px solid transparent;
    background: transparent;
    box-shadow: none;
    font: inherit;
    color: inherit;
    pointer-events: auto;
  }
  .${PAGE_LENS_DOCK_ROOT_CLASS} .lenses-page-dock-rail .lenses-page-dock-button.is-tail {
    height: 0;
    min-height: 0;
    border-width: 0;
    opacity: 0;
    overflow: hidden;
    pointer-events: none;
  }
  .${PAGE_LENS_DOCK_ROOT_CLASS} .lenses-page-dock[data-source-panel-open="true"] .lenses-page-dock-rail {
    display: none;
  }
  .${PAGE_LENS_DOCK_ROOT_CLASS} .lenses-page-dock-rail:hover .lenses-page-dock-button.is-tail,
  .${PAGE_LENS_DOCK_ROOT_CLASS} .lenses-page-dock-rail:focus-within .lenses-page-dock-button.is-tail,
  .${PAGE_LENS_DOCK_ROOT_CLASS} .lenses-page-dock[data-view="custom"] .lenses-page-dock-button.is-tail,
  .${PAGE_LENS_DOCK_ROOT_CLASS} .lenses-page-dock[data-view="dismiss"] .lenses-page-dock-button.is-tail {
    height: 30px;
    border-width: 1px;
    opacity: 1;
    pointer-events: auto;
  }
  .${PAGE_LENS_DOCK_ROOT_CLASS} .lenses-page-dock-rail:hover,
  .${PAGE_LENS_DOCK_ROOT_CLASS} .lenses-page-dock-rail:focus-within,
  .${PAGE_LENS_DOCK_ROOT_CLASS} .lenses-page-dock[data-view="custom"] .lenses-page-dock-rail,
  .${PAGE_LENS_DOCK_ROOT_CLASS} .lenses-page-dock[data-view="dismiss"] .lenses-page-dock-rail,
  .${PAGE_LENS_DOCK_ROOT_CLASS} .lenses-page-dock-panel,
  .${PAGE_LENS_DOCK_ROOT_CLASS} .lenses-page-dock-menu,
  .${PAGE_LENS_DOCK_ROOT_CLASS} .lenses-page-dock-toast {
    pointer-events: auto;
  }
  .${PAGE_LENS_DOCK_ROOT_CLASS} .lenses-page-dock-rail:hover,
  .${PAGE_LENS_DOCK_ROOT_CLASS} .lenses-page-dock-rail:focus-within,
  .${PAGE_LENS_DOCK_ROOT_CLASS} .lenses-page-dock[data-view="custom"] .lenses-page-dock-rail,
  .${PAGE_LENS_DOCK_ROOT_CLASS} .lenses-page-dock[data-view="dismiss"] .lenses-page-dock-rail {
    transform: translateY(calc(var(--lenses-page-dock-anchor-offset) * -1));
  }
  .${PAGE_LENS_DOCK_ROOT_CLASS} .lenses-page-dock-icon {
    width: 16px;
    height: 16px;
    flex: 0 0 auto;
  }
  .${PAGE_LENS_DOCK_ROOT_CLASS} .lenses-page-dock-tooltip {
    display: none;
  }
`;

export interface PageLensDockController {
  destroy: () => void;
}

export interface PageLensDockControllerOptions {
  getLensState: () => PageLensDockLensState;
  onLensDisplayModeChange: (lensId: string, mode: LensResultDisplayMode) => void;
  onLensResultsClear: (lensId: string) => void;
  onLensVisibilityChange: (lensId: string, visible: boolean) => void;
  subscribeToLensState: (listener: () => void) => () => void;
  // Called after the user picks "Turn off page dock" from the dismiss menu, so
  // the caller can surface an undo affordance before the dock disappears.
  onTurnedOff?: () => void;
}

export function mountPageLensDock({
  getLensState,
  onLensDisplayModeChange,
  onLensResultsClear,
  onLensVisibilityChange,
  subscribeToLensState,
  onTurnedOff,
}: PageLensDockControllerOptions): PageLensDockController {
  if (!shouldMountPageLensDock()) {
    return { destroy: () => undefined };
  }

  let destroyed = false;
  let active: { reactRoot: Root; mount: LensesShadowMount } | null = null;

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    active?.reactRoot.unmount();
    active?.mount.remove();
    active = null;
  }

  // Eligibility is resolved before any DOM is created, so pages where the
  // dock is disabled never pay for a host mount/unmount cycle. A failed
  // settings read falls back to showing the dock (the default-on behavior).
  // The destroyed flag covers the async gap: syncPageLensDock can destroy
  // this controller while the settings read is still in flight, and the late
  // resolution must not resurrect the dock.
  void shouldShowPageLensDock()
    .catch(() => true)
    .then((visible) => {
      if (destroyed) return;

      removeLensesShadowHosts("page-dock");
      removeExistingPageLensDockRoots();
      if (!visible) return;

      const mount = createLensesShadowMount({
        surface: "page-dock",
        rootClassName: PAGE_LENS_DOCK_ROOT_CLASS,
        ariaLabel: "Lenses page dock",
      });
      ensurePageDockCriticalStyles(mount.shadowRoot);

      const root = mount.root;
      root.style.visibility = "hidden";
      root.style.pointerEvents = "none";
      root.addEventListener("click", (event) => event.stopPropagation());
      root.addEventListener("mousedown", (event) => event.stopPropagation());

      const reactRoot: Root = createRoot(root);
      active = { reactRoot, mount };

      reactRoot.render(
        createElement(PageLensDock, {
          getLensState,
          onLensDisplayModeChange,
          onLensResultsClear,
          onLensVisibilityChange,
          subscribeToLensState,
          onDismiss: destroy,
          onTurnedOff,
        })
      );
      revealPageLensDockWhenStyled(root, () => destroyed);
    });

  return { destroy };
}

function shouldMountPageLensDock() {
  if (window.top !== window) return false;
  return window.location.protocol === "http:" || window.location.protocol === "https:";
}

function removeExistingPageLensDockRoots() {
  for (const root of document.querySelectorAll<HTMLElement>(`.${PAGE_LENS_DOCK_ROOT_CLASS}`)) {
    root.remove();
  }
}

function revealPageLensDockWhenStyled(root: HTMLElement, shouldAbort: () => boolean) {
  let frame = 0;

  function check() {
    if (shouldAbort() || !root.isConnected) return;
    if (isPageLensDockStyled(root) || frame >= PAGE_DOCK_STYLE_WAIT_FRAME_LIMIT) {
      root.style.visibility = "";
      root.style.pointerEvents = "";
      return;
    }
    frame++;
    window.requestAnimationFrame(check);
  }

  window.requestAnimationFrame(check);
}

function isPageLensDockStyled(root: HTMLElement) {
  const rootStyle = window.getComputedStyle(root);
  if (rootStyle.position !== "fixed") return false;

  const button = root.querySelector(".lenses-page-dock-button");
  if (!(button instanceof HTMLElement)) return false;

  const buttonStyle = window.getComputedStyle(button);
  return buttonStyle.display === "inline-flex" && buttonStyle.width === "30px";
}

function ensurePageDockCriticalStyles(target: Document | ShadowRoot) {
  if (target.getElementById(PAGE_DOCK_CRITICAL_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = PAGE_DOCK_CRITICAL_STYLE_ID;
  style.textContent = PAGE_DOCK_CRITICAL_CSS;
  if (target instanceof Document) {
    (target.head || target.documentElement).appendChild(style);
    return;
  }
  const stylesheet = target.querySelector('link[href$="content/highlight.css"]');
  target.insertBefore(style, stylesheet);
}

const PAGE_DOCK_TOAST_ROOT_CLASS = "lenses-page-dock-undo-toast";
const PAGE_DOCK_UNDO_TOAST_DURATION_MS = 9000;

// A single transient toast shown after the dock is turned off, mounted in its
// own shadow host so it outlives the dock it is replacing. Tracked module-side
// so a second trigger replaces the first instead of stacking.
let activeUndoToast: { mount: LensesShadowMount; timer: number } | null = null;

export function dismissPageDockUndoToast() {
  if (!activeUndoToast) return;
  window.clearTimeout(activeUndoToast.timer);
  activeUndoToast.mount.remove();
  activeUndoToast = null;
}

export function showPageDockUndoToast({
  message,
  actionLabel,
  onAction,
  durationMs = PAGE_DOCK_UNDO_TOAST_DURATION_MS,
}: {
  message: string;
  actionLabel: string;
  onAction: () => void;
  durationMs?: number;
}) {
  if (window.top !== window) return;
  dismissPageDockUndoToast();
  removeLensesShadowHosts("page-dock-toast");

  const mount = createLensesShadowMount({
    surface: "page-dock-toast",
    rootClassName: PAGE_DOCK_TOAST_ROOT_CLASS,
    ariaLabel: "Lenses notification",
    rootTagName: "div",
  });

  const toast = document.createElement("div");
  toast.setAttribute("role", "status");
  toast.style.cssText = [
    "position: fixed",
    "right: 24px",
    "bottom: 24px",
    "display: inline-flex",
    "align-items: center",
    "gap: 12px",
    "max-width: min(360px, calc(100vw - 48px))",
    "padding: 10px 12px 10px 16px",
    "border-radius: 10px",
    "background: #1f2937",
    "color: #f9fafb",
    "font: 13px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    "box-shadow: 0 6px 24px rgba(0, 0, 0, 0.28)",
    "pointer-events: auto",
  ].join(";");

  const label = document.createElement("span");
  label.textContent = message;

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = actionLabel;
  button.style.cssText = [
    "appearance: none",
    "border: 0",
    "background: transparent",
    "color: #93c5fd",
    "font: inherit",
    "font-weight: 600",
    "cursor: pointer",
    "padding: 4px 8px",
    "border-radius: 6px",
    "white-space: nowrap",
  ].join(";");
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    dismissPageDockUndoToast();
    onAction();
  });

  toast.append(label, button);
  mount.root.appendChild(toast);

  const timer = window.setTimeout(dismissPageDockUndoToast, durationMs);
  activeUndoToast = { mount, timer };
}
