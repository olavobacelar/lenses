import { resolve } from "node:path";
import { assertProductionArtifact, type ArtifactFlavor } from "./production-build";

const args = process.argv.slice(2);
const flavor: ArtifactFlavor = args.includes("--contest") ? "contest" : "production";
const rootArg = args.find((arg) => !arg.startsWith("--")) ?? "dist";
const artifactRoot = resolve(import.meta.dir, rootArg);
assertProductionArtifact(artifactRoot, flavor);
console.log(`Production artifact hygiene check passed (${flavor}): ${artifactRoot}`);
