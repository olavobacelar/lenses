import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

interface PackageMetadata {
  name?: string;
  version?: string;
  license?: string;
  dependencies?: Record<string, string>;
}

interface NoticeDocument {
  sources: string[];
  content: string;
}

const INTERNAL_PACKAGE_PREFIX = "@lenses/";
const LICENSE_OR_NOTICE = /^(?:license|notice)(?:[._-].*)?$/i;

/**
 * Build a deterministic notice file from the exact packages installed for the
 * extension. License text is copied verbatim from each package; missing
 * metadata fails the build instead of producing an incomplete notice.
 */
export function createThirdPartyNotices(extensionRoot: string): string {
  const extensionPackage = readPackageMetadata(join(extensionRoot, "package.json"));
  const dependencyNames = Object.keys(extensionPackage.dependencies ?? {})
    .filter((name) => !name.startsWith(INTERNAL_PACKAGE_PREFIX))
    .sort();
  const inventory: string[] = [];
  const documentsByContent = new Map<string, NoticeDocument>();

  for (const dependencyName of dependencyNames) {
    const dependencyRoot = join(extensionRoot, "node_modules", dependencyName);
    const metadata = readPackageMetadata(join(dependencyRoot, "package.json"));
    const name = metadata.name ?? dependencyName;
    const version = metadata.version;
    const license = metadata.license;
    if (!version || !license) {
      throw new Error(`Missing version or license metadata for ${dependencyName}`);
    }
    inventory.push(`- ${name}@${version} — ${license}`);

    const documentNames = readdirSync(dependencyRoot)
      .filter((filename) => LICENSE_OR_NOTICE.test(filename))
      .sort();
    if (documentNames.length === 0) {
      throw new Error(`Missing license document for ${name}@${version}`);
    }

    for (const documentName of documentNames) {
      const content = readFileSync(join(dependencyRoot, documentName), "utf8").trim();
      if (!content) throw new Error(`Empty ${documentName} for ${name}@${version}`);
      const source = `${name}@${version}/${documentName}`;
      const existing = documentsByContent.get(content);
      if (existing) {
        existing.sources.push(source);
      } else {
        documentsByContent.set(content, { sources: [source], content });
      }
    }
  }

  const documents = Array.from(documentsByContent.values()).sort((left, right) =>
    left.sources[0].localeCompare(right.sources[0])
  );
  const sections = documents.map(
    ({ sources, content }) => `${"=".repeat(72)}\n${sources.join("\n")}\n${"=".repeat(72)}\n\n${content}`
  );

  return [
    "Lenses third-party notices",
    "",
    "Generated from the installed direct runtime dependencies and their verbatim",
    "license and notice files. Transitive notices are preserved where included by",
    "an upstream package or copied runtime asset.",
    "",
    "Dependency inventory",
    "",
    ...inventory,
    "",
    "License and notice documents",
    "",
    ...sections,
    "",
  ].join("\n");
}

function readPackageMetadata(path: string): PackageMetadata {
  return JSON.parse(readFileSync(path, "utf8")) as PackageMetadata;
}
