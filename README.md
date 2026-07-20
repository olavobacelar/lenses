# Lenses

Lenses is a Manifest V3 browser extension for applying reusable AI-assisted ways of looking at web pages, PDFs, and YouTube sources. It keeps each reusable **Lens** separate from its runs, findings, and evidence base so results remain inspectable and attributable.

Built for the [FLF Epistemic Case Study Competition](https://flf.org/epistack-competition/), Lenses treats AI analysis as a traceable method applied to evidence—not as an opaque answer box.

## What it demonstrates

- Reusable, versioned Lenses for extracting, connecting, and assessing information.
- Web, text-layer PDF, and timestamped YouTube transcript ingestion.
- Findings grounded in bounded quotations, source anchors, and fingerprints.
- Evidence bases that keep sources, runs, findings, and coverage inspectable.
- A local-first mode plus an optional managed evaluation experience.

## Install the extension

### Prebuilt extension artifact

1. Download and unzip the extension archive supplied with the submission.
2. Open `chrome://extensions` in Chrome or another Chromium browser.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the unzipped directory.
5. Pin Lenses to the toolbar.

Managed mode is ready to use after installation; no access code or account is required. Local BYOK remains available for reviewers who prefer to use their own provider key.

### Build from source

Requirements: [Bun](https://bun.sh/) and a Chromium-based browser.

```bash
git clone https://github.com/olavobacelar/lenses.git
cd lenses
bun install
bun run build:production
```

Then load `packages/extension/dist` from `chrome://extensions` using **Load unpacked**.
The production command also verifies required runtime files, every local asset
referenced by the manifest or HTML, and the production permission policy.

## Open-source core, optional managed service

Lenses has two AI execution modes. **Local BYOK** sends requests directly from the extension to a supported provider using the user’s own API key and stores Lenses data locally in the browser.

The optional **Managed** mode provides a ready-to-use experience for people who prefer not to manage provider credentials. It uses the selected supported OpenAI or Anthropic model. Local BYOK supports the same providers with a key stored in the reviewer’s browser.

The managed service is a convenience and sustainability layer, not a requirement for using, inspecting, or extending Lenses.

## Development

Run the extension watcher:

```bash
cd packages/extension
bun run watch
```

From the repository root, run the test suite and TypeScript checks:

```bash
bun run test
bun run typecheck
```

Run `bun run build:production` for a distributable build, or
`bun run check:production` to re-check an existing build. The extension is
written to `packages/extension/dist`.

## Repository map

- `packages/extension` — browser extension UI, local runtime, and build.
- `packages/backend` — optional managed AI service.
- `packages/shared` — portable Lens and evidence contracts.

## Project status

The contest build (`bun run build:contest`) ships the two surfaces we have hardened: the sidebar workspace and the selection popup. The on-page rail and floating selection chat in this codebase run in development builds and are being polished for release - they are excluded from the contest artifact by design.

## License

Licensed under the [MIT License](LICENSE).
