import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, posix, relative } from "node:path";

type ManifestLike = Record<string, unknown> & {
  permissions?: string[];
  host_permissions?: string[];
  action?: Record<string, unknown>;
  commands?: Record<string, unknown>;
};

/**
 * Build flavors that ship to users. "contest" is the focused submission
 * artifact: only the side panel and the selection popup remain as entry
 * surfaces, so the toolbar popup and the page-dock keyboard command are
 * removed while settings and the evidence-base library stay.
 */
export type ArtifactFlavor = "production" | "contest";

export interface ProductionArtifactEntry {
  path: string;
  content?: string;
}

export function resolveNodeEnvironment(isProduction: boolean): "development" | "production" {
  return isProduction ? "production" : "development";
}

const INTERNAL_CSS_BLOCK =
  /\/\* INTERNAL_TOOLS_START \*\/[\s\S]*?\/\* INTERNAL_TOOLS_END \*\//g;

const TEXT_EXTENSIONS = new Set([".css", ".html", ".js", ".json", ".mjs"]);
const TEXT_FILENAMES = new Set(["LICENSE", "THIRD_PARTY_NOTICES"]);
const POPUP_FILES = ["popup/popup.html", "popup/popup.js", "popup/popup.css"];
const REQUIRED_FILES = [
  "LICENSE",
  "THIRD_PARTY_NOTICES",
  "manifest.json",
  "background/service-worker.js",
  "content/content.js",
  "content/highlight.css",
  ...POPUP_FILES,
  "sidepanel/sidepanel.html",
  "sidepanel/sidepanel.js",
  "sidepanel/sidepanel.css",
  "settings.html",
  "options/options.js",
  "options/options.css",
  "evidence-bases/evidence-bases.html",
  "evidence-bases/evidence-bases.js",
  "evidence-bases/evidence-bases.css",
  "pdf/pdf.worker.min.mjs",
  "pdf/standard_fonts/LiberationSans-Regular.ttf",
  "icons/icon-16.png",
  "icons/icon-32.png",
  "icons/icon-48.png",
  "icons/icon-128.png",
  "icons/icon-256.png",
  "icons/icon-512.png",
];

const FORBIDDEN_PATHS: Array<{ label: string; pattern: RegExp }> = [
  { label: "source map", pattern: /\.map$/i },
  { label: "non-runtime test data", pattern: /(^|\/)(?:fixtures?|test-data)(\/|$)/i },
  {
    label: "development-only surface",
    pattern: /(^|\/)(?:debug|dev)(?:[-./]|$)/i,
  },
];

const FORBIDDEN_TEXT: Array<{ label: string; pattern: RegExp }> = [
  {
    label: "loopback network target",
    pattern: /(?:https?|wss?):\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/i,
  },
  {
    label: "development-only asset reference",
    pattern: /(?:^|["'`/])(?:debug|dev|fixtures?)(?:[-/][^"'`\s]*)?\.(?:css|html|js)\b/i,
  },
  { label: "remote icon proxy", pattern: /\/s2\/favicons(?:\?|\/|$)/i },
  {
    label: "unresolved build marker",
    pattern: /__(?:DEV_RELOAD|INTERNAL_TOOLS|LOCAL_SLIDE_EXPORT|CONTEST_BUILD)__/,
  },
  { label: "internal CSS marker", pattern: /INTERNAL_TOOLS_(?:START|END)/ },
  { label: "source-map reference", pattern: /sourceMappingURL/i },
];

const MANIFEST_ASSET_EXTENSION =
  /\.(?:css|html?|js|mjs|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|otf|wasm)(?:[?#].*)?$/i;
const HTML_ASSET_ATTRIBUTE = /\b(?:href|src)\s*=\s*["']([^"']+)["']/gi;

/**
 * Apply defense-in-depth manifest filtering for the distributable. Explicit
 * loopback entries are redundant beside the extension's broad page access and
 * are removed as permission hygiene; this is not a network sandbox. The
 * extension-page CSP still permits HTTP where the product runtime requires it.
 */
export function createProductionManifest(source: ManifestLike): ManifestLike {
  const manifest = JSON.parse(JSON.stringify(source)) as ManifestLike;
  manifest.permissions = (manifest.permissions ?? []).filter(
    (permission) => permission !== "cookies"
  );
  manifest.host_permissions = (manifest.host_permissions ?? []).filter(
    (permission) =>
      !/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\*)?\/\*$/i.test(permission)
  );
  return manifest;
}

export function stripInternalToolCss(source: string): string {
  return source.replace(INTERNAL_CSS_BLOCK, "").replace(/\n{3,}/g, "\n\n");
}

/**
 * Reduce a shippable manifest to the contest surface set. Only the toolbar
 * popup entry is dropped, so `openPanelOnActionClick` (forced on by the contest
 * service worker) can route the icon to the side panel. The action block itself
 * stays so the icon remains clickable, and the page-dock keyboard command stays
 * because the right-side dock ships in this flavor.
 */
export function createContestManifest(source: ManifestLike): ManifestLike {
  const manifest = JSON.parse(JSON.stringify(source)) as ManifestLike;
  if (manifest.action) delete manifest.action.default_popup;
  return manifest;
}

export function findProductionArtifactViolations(
  entries: readonly ProductionArtifactEntry[],
  flavor: ArtifactFlavor = "production"
): string[] {
  const violations: string[] = [];
  const paths = new Set(entries.map((entry) => entry.path));

  const popupFiles = new Set(POPUP_FILES);
  const requiredFiles =
    flavor === "contest"
      ? REQUIRED_FILES.filter((file) => !popupFiles.has(file))
      : REQUIRED_FILES;
  for (const required of requiredFiles) {
    if (!paths.has(required)) violations.push(`missing required file: ${required}`);
  }

  if (flavor === "contest") {
    for (const entry of entries) {
      if (entry.path.startsWith("popup/")) {
        violations.push(`excluded contest surface: ${entry.path}`);
      }
    }
  }

  for (const entry of entries) {
    for (const forbidden of FORBIDDEN_PATHS) {
      if (forbidden.pattern.test(entry.path)) {
        violations.push(`${forbidden.label}: ${entry.path}`);
      }
    }

    if (entry.content === undefined) continue;
    for (const forbidden of FORBIDDEN_TEXT) {
      if (forbidden.pattern.test(entry.content)) {
        violations.push(`${forbidden.label}: ${entry.path}`);
      }
    }
  }

  const manifestEntry = entries.find((entry) => entry.path === "manifest.json");
  if (manifestEntry?.content !== undefined) {
    try {
      const manifest = JSON.parse(manifestEntry.content) as ManifestLike;
      if (manifest.permissions?.includes("cookies")) {
        violations.push("unused cookies permission: manifest.json");
      }
      if (flavor === "contest" && manifest.action?.default_popup !== undefined) {
        violations.push("contest manifest retains toolbar popup: manifest.json");
      }
      for (const permission of manifest.host_permissions ?? []) {
        if (/^http:\/\/(?:localhost|127\.0\.0\.1)/i.test(permission)) {
          violations.push(`redundant loopback host permission: ${permission}`);
        }
      }
      for (const reference of collectManifestAssetReferences(manifest)) {
        validateLocalAssetReference("manifest.json", reference, paths, violations);
      }
    } catch {
      violations.push("invalid JSON: manifest.json");
    }
  }

  for (const entry of entries) {
    if (!entry.path.endsWith(".html") || entry.content === undefined) continue;
    for (const match of entry.content.matchAll(HTML_ASSET_ATTRIBUTE)) {
      validateLocalAssetReference(entry.path, match[1], paths, violations);
    }
  }

  return [...new Set(violations)].sort();
}

function collectManifestAssetReferences(value: unknown): string[] {
  const references: string[] = [];

  const visit = (candidate: unknown) => {
    if (typeof candidate === "string") {
      if (MANIFEST_ASSET_EXTENSION.test(candidate)) references.push(candidate);
      return;
    }
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item);
      return;
    }
    if (!candidate || typeof candidate !== "object") return;
    for (const item of Object.values(candidate)) visit(item);
  };

  visit(value);
  return references;
}

function validateLocalAssetReference(
  fromPath: string,
  rawReference: string,
  artifactPaths: ReadonlySet<string>,
  violations: string[]
): void {
  const reference = rawReference.trim();
  if (
    !reference ||
    reference.startsWith("#") ||
    reference.startsWith("//") ||
    /^[a-z][a-z\d+.-]*:/i.test(reference)
  ) {
    return;
  }

  const withoutQuery = reference.split(/[?#]/, 1)[0];
  const resolved = posix.normalize(
    withoutQuery.startsWith("/")
      ? withoutQuery.slice(1)
      : posix.join(posix.dirname(fromPath), withoutQuery)
  );

  if (!resolved || resolved === "." || resolved === ".." || resolved.startsWith("../")) {
    violations.push(`invalid local asset reference: ${fromPath} -> ${reference}`);
    return;
  }
  if (!artifactPaths.has(resolved)) {
    violations.push(`missing referenced asset: ${fromPath} -> ${resolved}`);
  }
}

export function readProductionArtifact(root: string): ProductionArtifactEntry[] {
  if (!existsSync(root)) return [];
  const entries: ProductionArtifactEntry[] = [];

  const visit = (directory: string) => {
    for (const name of readdirSync(directory).sort()) {
      const absolutePath = join(directory, name);
      const info = statSync(absolutePath);
      if (info.isDirectory()) {
        visit(absolutePath);
        continue;
      }

      const artifactPath = relative(root, absolutePath).split("\\").join("/");
      const extension = artifactPath.slice(artifactPath.lastIndexOf(".")).toLowerCase();
      entries.push({
        path: artifactPath,
        ...(TEXT_EXTENSIONS.has(extension) || TEXT_FILENAMES.has(artifactPath)
          ? { content: readFileSync(absolutePath, "utf8") }
          : {}),
      });
    }
  };

  visit(root);
  return entries;
}

export function assertProductionArtifact(
  root: string,
  flavor: ArtifactFlavor = "production"
): void {
  const violations = findProductionArtifactViolations(readProductionArtifact(root), flavor);
  if (violations.length === 0) return;
  throw new Error(
    `Production artifact hygiene check failed:\n${violations
      .map((violation) => `- ${violation}`)
      .join("\n")}`
  );
}
