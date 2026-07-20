export type LensesShadowSurface =
  | "chatbox"
  | "citation-tooltip"
  | "orphaned-panel"
  | "page-dock"
  | "page-dock-toast"
  | "selection-trigger"
  | "source-callouts";

export const LENSES_SHADOW_HOST_CLASS = "lenses-shadow-host";

export type LensesShadowInteraction = "interactive" | "click-through";

// Every shadow host spans the full viewport (position: fixed; inset: 0) with
// pointer-events: none, so a surface's root decides what the page underneath
// loses. "interactive" roots are bounded panels that own every click inside
// their box (chat, selection popup). "click-through" roots must never absorb
// page clicks — only descendants that explicitly re-enable pointer-events
// (dock buttons, callout cards, the undo toast) are clickable. The page dock
// in particular floats over site controls (e.g. YouTube's video-card menus),
// so an interactive dock root would silently swallow the page's own buttons.
export const LENSES_SURFACE_INTERACTION: Record<
  LensesShadowSurface,
  LensesShadowInteraction
> = {
  chatbox: "interactive",
  "citation-tooltip": "click-through",
  "orphaned-panel": "interactive",
  "page-dock": "click-through",
  "page-dock-toast": "click-through",
  "selection-trigger": "interactive",
  "source-callouts": "click-through",
};

export interface LensesShadowMount {
  host: HTMLElement;
  themeScope: HTMLElement;
  root: HTMLElement;
  shadowRoot: ShadowRoot;
  remove: () => void;
}

const SHADOW_HOST_BASE_CSS = `
:host {
  all: initial !important;
  position: fixed !important;
  inset: 0 !important;
  z-index: 2147483645 !important;
  display: block !important;
  width: auto !important;
  height: auto !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  background: transparent !important;
  pointer-events: none !important;
  color-scheme: light;
}

:host([data-lenses-theme="dark"]) {
  color-scheme: dark;
}

:host([data-lenses-surface="page-dock-toast"]),
:host([data-lenses-surface="selection-trigger"]),
:host([data-lenses-surface="citation-tooltip"]) {
  z-index: 2147483647 !important;
}

/* The always-on dock is ambient UI: it floats above ordinary page content but
   yields to the site's own modals and overlays (common modal systems layer
   around 1000-1500, native <dialog> uses the top layer regardless). Only
   user-invoked, transient surfaces get the maximum z-index above. */
:host([data-lenses-surface="page-dock"]) {
  z-index: 990 !important;
}

:host([data-lenses-surface="chatbox"]),
:host([data-lenses-surface="source-callouts"]) {
  z-index: 2147483646 !important;
}

.lenses-shadow-theme-scope > [data-lenses-shadow-root][data-lenses-interaction="interactive"] {
  pointer-events: auto;
}

.lenses-shadow-theme-scope > [data-lenses-shadow-root][data-lenses-interaction="click-through"] {
  pointer-events: none;
}
`;

let currentTheme: "light" | "dark" =
  document.documentElement.getAttribute("data-lenses-theme") === "dark" ? "dark" : "light";

const mounts = new Set<LensesShadowMount>();

export function setLensesShadowTheme(theme: "light" | "dark") {
  currentTheme = theme;
  for (const mount of mounts) {
    mount.host.setAttribute("data-lenses-theme", theme);
    mount.themeScope.setAttribute("data-lenses-theme", theme);
  }
}

export function createLensesShadowMount({
  surface,
  rootClassName,
  ariaLabel,
  rootTagName = "section",
}: {
  surface: LensesShadowSurface;
  rootClassName: string;
  ariaLabel?: string;
  rootTagName?: keyof HTMLElementTagNameMap;
}): LensesShadowMount {
  const host = document.createElement("lenses-ui-root");
  host.className = LENSES_SHADOW_HOST_CLASS;
  host.dataset.lensesSurface = surface;
  host.setAttribute("data-lenses-theme", currentTheme);
  host.style.setProperty("all", "initial", "important");
  host.style.setProperty("position", "fixed", "important");
  host.style.setProperty("inset", "0", "important");
  host.style.setProperty("z-index", surfaceZIndex(surface), "important");
  host.style.setProperty("display", "block", "important");
  host.style.setProperty("pointer-events", "none", "important");
  host.style.setProperty("background", "transparent", "important");

  const shadowRoot = host.attachShadow({ mode: "open" });
  installShadowStyles(shadowRoot);

  const themeScope = document.createElement("div");
  themeScope.className = "lenses-shadow-theme-scope";
  themeScope.setAttribute("data-lenses-theme", currentTheme);

  const root = document.createElement(rootTagName);
  root.className = rootClassName;
  root.setAttribute("data-lenses-shadow-root", surface);
  root.setAttribute("data-lenses-interaction", LENSES_SURFACE_INTERACTION[surface]);
  if (ariaLabel) {
    root.setAttribute("aria-label", ariaLabel);
  }
  themeScope.appendChild(root);
  shadowRoot.appendChild(themeScope);
  document.body.appendChild(host);

  const mount: LensesShadowMount = {
    host,
    themeScope,
    root,
    shadowRoot,
    remove: () => {
      mounts.delete(mount);
      host.remove();
    },
  };
  mounts.add(mount);
  return mount;
}

export function removeLensesShadowHosts(surface: LensesShadowSurface) {
  for (const host of document.querySelectorAll<HTMLElement>(
    `.${LENSES_SHADOW_HOST_CLASS}[data-lenses-surface="${surface}"]`
  )) {
    host.remove();
  }
  for (const mount of Array.from(mounts)) {
    if (mount.host.dataset.lensesSurface === surface && !mount.host.isConnected) {
      mounts.delete(mount);
    }
  }
}

function installShadowStyles(shadowRoot: ShadowRoot) {
  const baseStyle = document.createElement("style");
  baseStyle.textContent = SHADOW_HOST_BASE_CSS;
  shadowRoot.appendChild(baseStyle);

  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = chrome.runtime.getURL("content/highlight.css");
  shadowRoot.appendChild(stylesheet);
}

function surfaceZIndex(surface: LensesShadowSurface) {
  if (surface === "page-dock") return "990";
  if (
    surface === "page-dock-toast" ||
    surface === "selection-trigger" ||
    surface === "citation-tooltip"
  ) {
    return "2147483647";
  }
  if (surface === "chatbox" || surface === "source-callouts") return "2147483646";
  return "2147483645";
}
