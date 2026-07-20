import { build, type BuildConfig } from "bun";
import { cpSync, mkdirSync, readFileSync, rmSync, watch, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import {
  assertProductionArtifact,
  createContestManifest,
  createProductionManifest,
  resolveNodeEnvironment,
  stripInternalToolCss,
} from "./production-build";
import { createThirdPartyNotices } from "./third-party-notices";

const outdir = join(import.meta.dir, "dist");
const isWatch = process.argv.includes("--watch");
const isProduction = process.argv.includes("--production");
// Contest flavor: ship only the side panel and selection popup as entry
// surfaces. The toolbar popup is not built and the manifest routes the icon
// straight to the side panel; settings and the evidence-base library remain.
const isContest = process.argv.includes("--contest");
const contentStylesheetEntry = join(import.meta.dir, "src/content/highlight.css");
let shouldCleanOutput = true;

if (isWatch && isProduction) {
  throw new Error("--watch and --production cannot be used together");
}

function bundleLocalCssImports(entryPath: string, seen = new Set<string>()): string {
  const absolutePath = resolve(entryPath);
  if (seen.has(absolutePath)) {
    throw new Error(`Circular CSS import in ${absolutePath}`);
  }
  seen.add(absolutePath);

  const source = readFileSync(absolutePath, "utf-8");
  const chunks: string[] = [];
  let passthroughLines: string[] = [];

  const flushPassthrough = () => {
    const passthrough = passthroughLines.join("\n").trimEnd();
    if (passthrough) chunks.push(passthrough);
    passthroughLines = [];
  };

  for (const line of source.split(/\r?\n/)) {
    const importMatch = line.match(/^\s*@import\s+["'](.+)["'];\s*$/);
    if (!importMatch) {
      passthroughLines.push(line);
      continue;
    }

    flushPassthrough();
    const importPath = importMatch[1];
    if (!importPath.startsWith(".")) {
      throw new Error(`Only local CSS imports are supported in ${absolutePath}: ${importPath}`);
    }
    chunks.push(bundleLocalCssImports(resolve(dirname(absolutePath), importPath), seen));
  }

  flushPassthrough();
  seen.delete(absolutePath);
  return `${chunks.map((chunk) => chunk.trimEnd()).filter(Boolean).join("\n\n")}\n`;
}

const shared: Partial<BuildConfig> = {
  outdir,
  minify: isProduction,
  sourcemap: isProduction ? "none" : "external",
  target: "browser",
  define: {
    __DEV_RELOAD__: isWatch ? "true" : "false",
    __INTERNAL_TOOLS__: isProduction ? "false" : "true",
    __LOCAL_SLIDE_EXPORT__: isProduction ? "false" : "true",
    __CONTEST_BUILD__: isContest ? "true" : "false",
    "process.env.NODE_ENV": JSON.stringify(resolveNodeEnvironment(isProduction)),
    "import.meta.env.VITE_SLIDE_EXPORT_SERVER_URL": JSON.stringify(
      process.env.VITE_SLIDE_EXPORT_SERVER_URL ??
        process.env.SLIDE_EXPORT_SERVER_URL ??
        "http://127.0.0.1:8765"
    ),
  },
};

async function buildExtension() {
  // Always start a requested build from an empty directory. This prevents a
  // production package from inheriting source maps or internal files from a
  // previous development build.
  if (shouldCleanOutput) {
    rmSync(outdir, { recursive: true, force: true });
    mkdirSync(outdir, { recursive: true });
    shouldCleanOutput = false;
  }

  // Build background service worker
  await build({
    ...shared,
    entrypoints: [join(import.meta.dir, "src/background/service-worker.ts")],
    outdir: join(outdir, "background"),
  });

  // Build content script
  await build({
    ...shared,
    entrypoints: [join(import.meta.dir, "src/content/content.ts")],
    outdir: join(outdir, "content"),
  });

  // Build popup (excluded from contest artifacts along with its assets below)
  if (!isContest) {
    await build({
      ...shared,
      entrypoints: [
        join(import.meta.dir, "src/popup/popup.tsx"),
        ...(isProduction ? [] : [join(import.meta.dir, "src/popup/debug-view.tsx")]),
      ],
      outdir: join(outdir, "popup"),
    });
  }

  // Build source side panel
  await build({
    ...shared,
    entrypoints: [join(import.meta.dir, "src/sidepanel/sidepanel.tsx")],
    outdir: join(outdir, "sidepanel"),
  });

  // Build settings page
  await build({
    ...shared,
    entrypoints: [join(import.meta.dir, "src/options/options.tsx")],
    outdir: join(outdir, "options"),
  });

  // Build evidence-base library
  await build({
    ...shared,
    entrypoints: [join(import.meta.dir, "src/evidence-bases/evidence-bases.tsx")],
    outdir: join(outdir, "evidence-bases"),
  });

  // Generate the manifest for the requested build flavor. Production applies
  // an additional permission filter; watch mode adds only the reload socket.
  const sourceManifest = JSON.parse(
    readFileSync(join(import.meta.dir, "manifest.json"), "utf-8")
  );
  let manifest = isProduction
    ? createProductionManifest(sourceManifest)
    : sourceManifest;
  if (isContest) manifest = createContestManifest(manifest);
  if (isWatch) {
    const csp = manifest.content_security_policy?.extension_pages ?? "";
    manifest.content_security_policy.extension_pages = csp.replace(
      "connect-src",
      "connect-src ws://localhost:8234"
    );
  }
  writeFileSync(join(outdir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  cpSync(join(import.meta.dir, "..", "..", "LICENSE"), join(outdir, "LICENSE"));
  writeFileSync(
    join(outdir, "THIRD_PARTY_NOTICES"),
    createThirdPartyNotices(import.meta.dir)
  );
  if (!isContest) {
    cpSync(
      join(import.meta.dir, "src/popup/popup.html"),
      join(outdir, "popup/popup.html")
    );
    const popupStyles = readFileSync(join(import.meta.dir, "src/popup/popup.css"), "utf8");
    writeFileSync(
      join(outdir, "popup/popup.css"),
      isProduction ? stripInternalToolCss(popupStyles) : popupStyles
    );
  }
  cpSync(
    join(import.meta.dir, "src/sidepanel/sidepanel.html"),
    join(outdir, "sidepanel/sidepanel.html")
  );
  cpSync(
    join(import.meta.dir, "src/sidepanel/sidepanel.css"),
    join(outdir, "sidepanel/sidepanel.css")
  );
  cpSync(
    join(import.meta.dir, "src/evidence-bases/evidence-bases.html"),
    join(outdir, "evidence-bases/evidence-bases.html")
  );
  cpSync(
    join(import.meta.dir, "src/evidence-bases/evidence-bases.css"),
    join(outdir, "evidence-bases/evidence-bases.css")
  );
  mkdirSync(join(outdir, "pdf"), { recursive: true });
  cpSync(
    join(import.meta.dir, "node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs"),
    join(outdir, "pdf/pdf.worker.min.mjs")
  );
  cpSync(
    join(import.meta.dir, "node_modules/pdfjs-dist/standard_fonts"),
    join(outdir, "pdf/standard_fonts"),
    { recursive: true }
  );
  cpSync(
    join(import.meta.dir, "src/settings.html"),
    join(outdir, "settings.html")
  );
  rmSync(join(outdir, "options/settings.html"), { force: true });
  rmSync(join(outdir, "options/options.html"), { force: true });
  cpSync(
    join(import.meta.dir, "src/options/options.css"),
    join(outdir, "options/options.css")
  );
  if (!isProduction && !isContest) {
    mkdirSync(join(outdir, "popup/fixtures"), { recursive: true });
    try {
      cpSync(
        join(import.meta.dir, "..", "..", "test", "fixtures", "source-check-synthetic.txt"),
        join(outdir, "popup/fixtures/source-check-synthetic.txt")
      );
    } catch {
      // The synthetic fixture is optional in development environments.
    }
    cpSync(
      join(import.meta.dir, "src/popup/debug-view.html"),
      join(outdir, "popup/debug-view.html")
    );
    cpSync(
      join(import.meta.dir, "src/popup/debug-view.css"),
      join(outdir, "popup/debug-view.css")
    );
  }
  const contentStyles = bundleLocalCssImports(contentStylesheetEntry);
  writeFileSync(
    join(outdir, "content/highlight.css"),
    isProduction ? stripInternalToolCss(contentStyles) : contentStyles
  );

  // Copy icons directory
  mkdirSync(join(outdir, "icons"), { recursive: true });
  try {
    cpSync(join(import.meta.dir, "icons"), join(outdir, "icons"), {
      recursive: true,
    });
  } catch {
    // Icons dir may not exist yet
  }

  if (isProduction) {
    assertProductionArtifact(outdir, isContest ? "contest" : "production");
  }

  console.log(
    isProduction
      ? `Production${isContest ? " contest" : ""} extension built and verified in dist/`
      : `Development${isContest ? " contest" : ""} extension built to dist/`
  );
}

// Initial build
await buildExtension();

if (isWatch) {
  const RELOAD_PORT = 8234;

  let server: ReturnType<typeof Bun.serve> | null = null;
  try {
    server = Bun.serve({
      port: RELOAD_PORT,
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response("Lenses dev reload server");
      },
      websocket: {
        open(ws) {
          ws.subscribe("reload");
        },
        message() {},
      },
    });

    console.log(`Reload server on ws://localhost:${RELOAD_PORT}`);
  } catch (caught) {
    console.warn(
      `Reload server unavailable on ws://localhost:${RELOAD_PORT}; continuing with rebuild-only watch.`
    );
    console.warn(caught);
  }

  const srcDir = join(import.meta.dir, "src");
  let debounce: Timer | null = null;
  let pendingFilename: string | null = null;
  let rebuildInProgress = false;

  const runQueuedBuild = async () => {
    if (rebuildInProgress) return;
    rebuildInProgress = true;

    try {
      while (pendingFilename !== null) {
        const filename = pendingFilename;
        pendingFilename = null;
        console.log(`Changed: ${filename} — rebuilding...`);

        try {
          await buildExtension();
          if (server) {
            server.publish("reload", "reload");
            console.log("Reload signal sent");
          } else {
            console.log("Reload server unavailable; rebuilt without reload signal");
          }
        } catch (caught) {
          console.error("Extension rebuild failed; watcher remains active.", caught);
        }
      }
    } finally {
      rebuildInProgress = false;
      if (pendingFilename !== null) void runQueuedBuild();
    }
  };

  watch(srcDir, { recursive: true }, (_event, filename) => {
    pendingFilename = filename?.toString() ?? "source file";
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      void runQueuedBuild();
    }, 150);
  });

  console.log("Watching src/ for changes...");
}
