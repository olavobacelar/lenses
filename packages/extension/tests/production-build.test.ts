import { describe, expect, it } from "vitest";
import {
  createProductionManifest,
  findProductionArtifactViolations,
  resolveNodeEnvironment,
  stripInternalToolCss,
  type ProductionArtifactEntry,
} from "../production-build";

function cleanArtifact(): ProductionArtifactEntry[] {
  return [
    { path: "LICENSE", content: "MIT License" },
    { path: "THIRD_PARTY_NOTICES", content: "Dependency inventory" },
    {
      path: "manifest.json",
      content: JSON.stringify({
        manifest_version: 3,
        permissions: ["storage", "sidePanel"],
        host_permissions: ["<all_urls>", "https://api.openai.com/*"],
      }),
    },
    { path: "background/service-worker.js", content: "console.info('ready')" },
    { path: "content/content.js", content: "export {}" },
    { path: "content/highlight.css", content: ".highlight {}" },
    { path: "popup/popup.html", content: '<script src="popup.js"></script>' },
    { path: "popup/popup.js", content: "export {}" },
    { path: "popup/popup.css", content: ".popup {}" },
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

describe("production extension policy", () => {
  it("uses development semantics for normal builds and production only when requested", () => {
    expect(resolveNodeEnvironment(false)).toBe("development");
    expect(resolveNodeEnvironment(true)).toBe("production");
  });

  it("removes redundant permissions without mutating the source manifest", () => {
    const source = {
      manifest_version: 3,
      permissions: ["storage", "cookies"],
      host_permissions: [
        "<all_urls>",
        "http://localhost:*/*",
        "http://127.0.0.1:*/*",
      ],
    };

    const production = createProductionManifest(source);

    expect(production.permissions).toEqual(["storage"]);
    expect(production.host_permissions).toEqual(["<all_urls>"]);
    expect(source.permissions).toContain("cookies");
  });

  it("accepts a complete compiled production artifact", () => {
    expect(findProductionArtifactViolations(cleanArtifact())).toEqual([]);
  });

  it("checks every local asset referenced by the manifest", () => {
    const artifact = cleanArtifact();
    const manifest = artifact.find((entry) => entry.path === "manifest.json");
    manifest!.content = JSON.stringify({
      manifest_version: 3,
      action: { default_popup: "popup/missing.html" },
    });

    expect(findProductionArtifactViolations(artifact)).toContain(
      "missing referenced asset: manifest.json -> popup/missing.html"
    );
  });

  it("checks local assets referenced relative to each HTML file", () => {
    const artifact = cleanArtifact();
    const popup = artifact.find((entry) => entry.path === "popup/popup.html");
    popup!.content = [
      '<link rel="stylesheet" href="popup.css">',
      '<script src="missing.js"></script>',
    ].join("\n");

    expect(findProductionArtifactViolations(artifact)).toContain(
      "missing referenced asset: popup/popup.html -> popup/missing.js"
    );
  });

  it("removes explicitly marked internal CSS while preserving public styles", () => {
    const source = [
      ".public { color: green; }",
      "/* INTERNAL_TOOLS_START */",
      ".debug-panel { display: block; }",
      "/* INTERNAL_TOOLS_END */",
      ".public-again { color: blue; }",
    ].join("\n");

    expect(stripInternalToolCss(source)).toContain(".public { color: green; }");
    expect(stripInternalToolCss(source)).toContain(".public-again { color: blue; }");
    expect(stripInternalToolCss(source)).not.toContain("debug-panel");
  });

  it.each([
    ["source maps", { path: "popup/popup.js.map", content: "{}" }],
    ["fixtures", { path: "popup/fixtures/sample.txt", content: "sample" }],
    ["debug pages", { path: "popup/debug-view.html", content: "Debug" }],
    ["localhost code", { path: "sidepanel/sidepanel.js", content: "http://127.0.0.1:8765" }],
    [
      "third-party favicons",
      { path: "content/content.js", content: "https://icons.invalid/s2/favicons" },
    ],
  ])("rejects %s", (_label, forbiddenEntry) => {
    const artifact = cleanArtifact().filter((entry) => entry.path !== forbiddenEntry.path);
    artifact.push(forbiddenEntry);
    expect(findProductionArtifactViolations(artifact)).not.toEqual([]);
  });
});
