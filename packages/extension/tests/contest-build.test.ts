import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createContestManifest,
  createProductionManifest,
  findProductionArtifactViolations,
  type ProductionArtifactEntry,
} from "../production-build";

const here = dirname(fileURLToPath(import.meta.url));
const extensionRoot = join(here, "..");

function readExtensionFile(relativePath: string): string {
  return readFileSync(join(extensionRoot, relativePath), "utf-8");
}

function sourceManifest(): Record<string, unknown> {
  return JSON.parse(readExtensionFile("manifest.json"));
}

function contestArtifact(): ProductionArtifactEntry[] {
  // The real transform pipeline output, validated end-to-end: every asset the
  // shipped contest manifest references must resolve inside this entry list.
  const manifest = createContestManifest(createProductionManifest(sourceManifest()));
  return [
    { path: "LICENSE", content: "MIT License" },
    { path: "THIRD_PARTY_NOTICES", content: "Dependency inventory" },
    { path: "manifest.json", content: JSON.stringify(manifest) },
    { path: "background/service-worker.js", content: "console.info('ready')" },
    { path: "content/content.js", content: "export {}" },
    { path: "content/highlight.css", content: ".highlight {}" },
    { path: "sidepanel/sidepanel.html", content: '<script src="sidepanel.js"></script>' },
    { path: "sidepanel/sidepanel.js", content: "export {}" },
    { path: "sidepanel/sidepanel.css", content: ".sidepanel {}" },
    { path: "settings.html", content: '<script src="options/options.js"></script>' },
    { path: "options/options.js", content: "export {}" },
    { path: "options/options.css", content: ".options {}" },
    {
      path: "evidence-bases/evidence-bases.html",
      content: '<script src="evidence-bases.js"></script>',
    },
    { path: "evidence-bases/evidence-bases.js", content: "export {}" },
    { path: "evidence-bases/evidence-bases.css", content: ".evidence {}" },
    { path: "pdf/pdf.worker.min.mjs", content: "export {}" },
    { path: "pdf/standard_fonts/LiberationSans-Regular.ttf" },
    { path: "icons/icon-16.png" },
    { path: "icons/icon-32.png" },
    { path: "icons/icon-48.png" },
    { path: "icons/icon-128.png" },
    { path: "icons/icon-256.png" },
    { path: "icons/icon-512.png" },
  ];
}

describe("contest manifest", () => {
  it("removes the toolbar popup while keeping the action icon clickable", () => {
    const manifest = createContestManifest(sourceManifest()) as {
      action?: Record<string, unknown>;
    };

    expect(manifest.action).toBeDefined();
    expect(manifest.action?.default_popup).toBeUndefined();
    expect(manifest.action?.default_icon).toBeDefined();
  });

  it("keeps the page-dock keyboard command: the right-side dock ships in contest builds", () => {
    const manifest = createContestManifest(sourceManifest()) as {
      commands?: Record<string, unknown>;
    };

    expect(manifest.commands?.["toggle-page-dock"]).toBeDefined();
  });

  it("preserves the kept surfaces: side panel, settings, content script", () => {
    const manifest = createContestManifest(sourceManifest()) as {
      side_panel?: { default_path?: string };
      options_ui?: { page?: string };
      content_scripts?: unknown[];
    };

    expect(manifest.side_panel?.default_path).toBe("sidepanel/sidepanel.html");
    expect(manifest.options_ui?.page).toBe("settings.html");
    expect(manifest.content_scripts).toHaveLength(1);
  });

  it("does not mutate the source manifest", () => {
    const source = sourceManifest();
    const before = JSON.stringify(source);
    createContestManifest(source);
    expect(JSON.stringify(source)).toBe(before);
  });
});

describe("contest artifact policy", () => {
  it("accepts a popup-free contest artifact", () => {
    expect(findProductionArtifactViolations(contestArtifact(), "contest")).toEqual([]);
  });

  it("rejects popup files that leak into a contest artifact", () => {
    const entries = [
      ...contestArtifact(),
      { path: "popup/popup.js", content: "export {}" },
    ];

    expect(findProductionArtifactViolations(entries, "contest")).toContain(
      "excluded contest surface: popup/popup.js"
    );
  });

  it("still requires popup files for the production flavor", () => {
    const violations = findProductionArtifactViolations(contestArtifact(), "production");

    expect(violations).toContain("missing required file: popup/popup.html");
    expect(violations).toContain("missing required file: popup/popup.js");
    expect(violations).toContain("missing required file: popup/popup.css");
  });

  it("rejects a contest manifest that retains the toolbar popup", () => {
    const entries = contestArtifact().map((entry) =>
      entry.path === "manifest.json"
        ? {
            path: entry.path,
            content: JSON.stringify({
              ...JSON.parse(entry.content ?? "{}"),
              action: { default_popup: "popup/popup.html" },
            }),
          }
        : entry
    );

    const violations = findProductionArtifactViolations(entries, "contest");
    expect(violations).toContain("contest manifest retains toolbar popup: manifest.json");
  });

  it("allows the page-dock command in a contest manifest", () => {
    // The command is legitimate in this flavor, so its presence must not trip
    // the hygiene check even though the toolbar popup is forbidden.
    const violations = findProductionArtifactViolations(contestArtifact(), "contest");
    expect(violations).not.toContain("contest manifest retains page-dock command: manifest.json");
  });

  it("flags unresolved contest build markers", () => {
    const entries = contestArtifact().map((entry) =>
      entry.path === "content/content.js"
        ? { path: entry.path, content: "if (__CONTEST_BUILD__) {}" }
        : entry
    );

    expect(findProductionArtifactViolations(entries, "contest")).toContain(
      "unresolved build marker: content/content.js"
    );
  });
});

describe("contest build wiring", () => {
  it("defines __CONTEST_BUILD__ and applies the contest manifest transform", () => {
    const build = readExtensionFile("build.ts");

    expect(build).toContain('process.argv.includes("--contest")');
    expect(build).toContain("__CONTEST_BUILD__: isContest");
    expect(build).toContain("createContestManifest(manifest)");
    expect(build).toContain('isContest ? "contest" : "production"');
  });

  it("skips building and copying the popup in contest builds", () => {
    const build = readExtensionFile("build.ts");

    const popupBuild = build.indexOf("// Build popup");
    const popupBuildBlock = build.slice(popupBuild, build.indexOf("});", popupBuild));
    expect(popupBuildBlock).toContain("if (!isContest)");

    const popupCopy = build.indexOf("src/popup/popup.html");
    expect(build.lastIndexOf("if (!isContest)", popupCopy)).toBeGreaterThan(
      build.indexOf("sourcemap", 0)
    );
  });

  it("exposes contest build and check scripts", () => {
    const scripts = JSON.parse(readExtensionFile("package.json")).scripts as Record<
      string,
      string
    >;

    expect(scripts["build:contest"]).toBe("bun run build.ts --production --contest");
    expect(scripts["check:contest"]).toBe(
      "bun run check-production-artifact.ts dist --contest"
    );
  });
});

describe("contest runtime gating", () => {
  it("mounts the page dock in contest builds (the right-side dock ships here)", () => {
    const content = readExtensionFile("src/content/content.ts");

    const mount = content.indexOf("function mountManagedPageLensDock()");
    const mountBody = content.slice(mount, content.indexOf("pageLensDockController =", mount));
    expect(mountBody).not.toContain("CONTEST_BUILD");
  });

  it("routes selection chat actions to the side panel in contest builds", () => {
    const content = readExtensionFile("src/content/content.ts");

    const surface = content.indexOf("function openChatSurface(");
    const surfaceBody = content.slice(surface, content.indexOf("}", surface));
    expect(surfaceBody).toContain("!CONTEST_BUILD && !chatActionsUseSidePanel");
  });

  it("pins the toolbar icon to the side panel in the service worker", () => {
    const worker = readExtensionFile("src/background/service-worker.ts");

    const unified = worker.indexOf("function isUnifiedPanelEnabled(");
    const unifiedBody = worker.slice(unified, worker.indexOf("return value === true;", unified));
    expect(unifiedBody).toContain("if (CONTEST_BUILD) return true;");
  });

  it("omits the popup context menu item but keeps the page-dock toggle in contest builds", () => {
    const worker = readExtensionFile("src/background/service-worker.ts");

    const install = worker.indexOf("chrome.contextMenus.removeAll(");
    // The dock toggle is created unconditionally, before the popup guard.
    const dockItem = worker.indexOf("PAGE_DOCK_TOGGLE_MENU_ID,", install);
    const popupItem = worker.indexOf("OPEN_ACTION_POPUP_MENU_ID,", install);
    const popupGuard = worker.lastIndexOf("if (!CONTEST_BUILD) {", popupItem);

    expect(dockItem).toBeGreaterThan(install);
    expect(popupGuard).toBeGreaterThan(dockItem);
    expect(popupGuard).toBeLessThan(popupItem);
  });

  it("always hosts the popup controls in the side panel control bay", () => {
    const controlBay = readExtensionFile("src/sidepanel/hooks/useControlBay.ts");

    expect(controlBay).toContain("useState(CONTEST_BUILD)");
    expect(controlBay).toContain(
      "CONTEST_BUILD || isUnifiedPanelEnabled(sync[UNIFIED_PANEL_KEY])"
    );
    expect(controlBay).toContain(
      "CONTEST_BUILD || isUnifiedPanelEnabled(changes[UNIFIED_PANEL_KEY].newValue)"
    );
  });

  it("hides settings rows for surfaces excluded from contest builds", () => {
    const options = readExtensionFile("src/options/OptionsApp.tsx");

    // The toolbar-behavior row (popup vs side panel) and the floating-chat
    // routing toggle configure surfaces that are absent, so both are guarded.
    const toolbarRow = options.indexOf('id="experimental-unified-panel"');
    expect(options.lastIndexOf("{!CONTEST_BUILD ? (", toolbarRow)).toBeGreaterThan(-1);

    const chatActionsRow = options.indexOf('id="chat-actions-use-side-panel"');
    expect(options.lastIndexOf("{!CONTEST_BUILD ? (", chatActionsRow)).toBeGreaterThan(-1);
  });

  it("keeps the Right rail settings section visible: the dock ships in contest builds", () => {
    const options = readExtensionFile("src/options/OptionsApp.tsx");

    expect(options).toContain('id="rail"');
    expect(options).not.toMatch(/\{!CONTEST_BUILD \? \(\s*<section id="rail"/);
  });

  it("keeps the selection popup settings section visible in contest builds", () => {
    const options = readExtensionFile("src/options/OptionsApp.tsx");

    expect(options).toContain('id="selection-popup"');
    expect(options).not.toMatch(/\{!CONTEST_BUILD \? \(\s*<section\s+id="selection-popup"/);
  });
});
