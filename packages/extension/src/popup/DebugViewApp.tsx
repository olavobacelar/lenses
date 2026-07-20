import { CopyIcon } from "@radix-ui/react-icons";
import { useEffect, useMemo, useState } from "react";
import {
  formatTimestamp,
  getCopyChunks,
  getDefuddleFormattedText,
  getReadabilityContentText,
  getTopCopyActions,
  lensLabel,
  toPrettyJson,
} from "./debugModel";
import { parseDebugViewPayload } from "./schemas";
import type { DebugRun, DebugViewPayload } from "./types";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; payload: DebugViewPayload };

export function DebugViewApp() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const key = getStorageKey();
      if (!key) {
        setState({ status: "error", message: "Missing debug payload key." });
        return;
      }

      try {
        const value = await chrome.storage.local.get(key);
        chrome.storage.local.remove(key);
        if (cancelled) return;

        const payload = parseDebugViewPayload(value[key]);
        if (!payload) {
          setState({
            status: "error",
            message: "Debug payload not found. Re-open from the popup.",
          });
          return;
        }

        document.documentElement.setAttribute("data-theme", payload.theme);
        setState({ status: "ready", payload });
      } catch (error) {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") {
    return <ErrorShell title="Lenses Debug View" message="Loading debug payload..." />;
  }
  if (state.status === "error") {
    return <ErrorShell title="Debug View Error" message={state.message} error />;
  }

  return <DebugView payload={state.payload} />;
}

function DebugView({ payload }: { payload: DebugViewPayload }) {
  const chunks = useMemo(() => getCopyChunks(payload), [payload]);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [toast, setToast] = useState("");

  const copyChunk = async (key: string) => {
    const markdown = chunks[key];
    if (!markdown) return;
    await navigator.clipboard.writeText(markdown);
    setCopiedKey(key);
    setToast("Copied");
    setTimeout(() => {
      setCopiedKey((current) => (current === key ? null : current));
      setToast("");
    }, 1100);
  };

  const defuddleText = payload.defuddle ? getDefuddleFormattedText(payload.defuddle) : "";
  const readabilityText = getReadabilityContentText(payload.readability);

  return (
    <>
      <div className="wrap">
        <section className="panel">
          <h1>Lenses Debug View</h1>
          <p className="sub">Source URL: {payload.sourceUrl}</p>
          <p className="sub">
            Generated at: {payload.generatedAt}
            {" \u00b7 "}
            Runs: {payload.runs.length}
          </p>
          <div className="actions">
            {getTopCopyActions().map((action) => (
              <CopyButton
                key={action.key}
                copyKey={action.key}
                copied={copiedKey === action.key}
                label={action.label}
                withLabel
                onCopy={copyChunk}
              />
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="card-head">
            <h2>Page Content</h2>
            <CopyButton
              copyKey="page"
              copied={copiedKey === "page"}
              label="Copy section"
              onCopy={copyChunk}
            />
          </div>
          <pre>{payload.pageText}</pre>
        </section>

        <section className="panel">
          <h2>Defuddle</h2>
          <div className="grid">
            {payload.defuddle ? (
              <div className="card">
                <div className="card-head">
                  <h3>{payload.defuddle.title ?? "Untitled"}</h3>
                  <CopyButton
                    copyKey="defuddle"
                    copied={copiedKey === "defuddle"}
                    label="Copy section"
                    onCopy={copyChunk}
                  />
                </div>
                <pre>{defuddleText || "No defuddled content available."}</pre>
                <details>
                  <summary>Metadata</summary>
                  <pre>{getDefuddleMetaText(payload.defuddle)}</pre>
                </details>
              </div>
            ) : (
              <p className="empty">Defuddle could not extract content for this page.</p>
            )}
          </div>
        </section>

        <section className="panel">
          <h2>Readability</h2>
          <div className="grid">
            {payload.readability ? (
              <div className="card">
                <div className="card-head">
                  <h3>{payload.readability.title ?? "Untitled"}</h3>
                  <CopyButton
                    copyKey="readability"
                    copied={copiedKey === "readability"}
                    label="Copy section"
                    onCopy={copyChunk}
                  />
                </div>
                <pre>{readabilityText || "No readability content available."}</pre>
                <details>
                  <summary>Metadata</summary>
                  <pre>{getReadabilityMetaText(payload.readability)}</pre>
                </details>
              </div>
            ) : (
              <p className="empty">Readability could not extract content for this page.</p>
            )}
          </div>
        </section>

        <section className="panel">
          <h2>Raw AI Results</h2>
          <div className="grid">
            {payload.runs.length === 0 ? (
              <p className="empty">No raw AI results found for this page.</p>
            ) : (
              payload.runs.map((run, index) => (
                <RunCard
                  key={`${run.lensId}:${run.runId}`}
                  run={run}
                  copyKey={`run-${index}`}
                  copied={copiedKey === `run-${index}`}
                  onCopy={copyChunk}
                />
              ))
            )}
          </div>
        </section>
      </div>
      <div id="copy-status" className={toast ? "show" : ""}>
        {toast}
      </div>
    </>
  );
}

function RunCard({
  run,
  copyKey,
  copied,
  onCopy,
}: {
  run: DebugRun;
  copyKey: string;
  copied: boolean;
  onCopy: (key: string) => Promise<void>;
}) {
  return (
    <article className="card">
      <div className="card-head">
        <h3>{lensLabel(run.lensId)}</h3>
        <CopyButton copyKey={copyKey} copied={copied} label="Copy run" onCopy={onCopy} />
      </div>
      <p className="meta">
        Lens ID: <code>{run.lensId}</code>
        {" \u00b7 "}
        Run ID: <code>{run.runId}</code>
      </p>
      <p className="meta">
        Model: <code>{run.modelUsed ?? "unknown"}</code>
        {" \u00b7 "}
        Created: {formatTimestamp(run.createdAt)}
        {" \u00b7 "}
        Findings: {run.findings.length}
      </p>
      <details open>
        <summary>Parsed findings JSON</summary>
        <pre>{toPrettyJson(run.findings)}</pre>
      </details>
      <details>
        <summary>Raw model output</summary>
        <pre>{run.rawResponse ?? "No raw response available."}</pre>
      </details>
    </article>
  );
}

function CopyButton({
  copyKey,
  copied,
  label,
  withLabel = false,
  onCopy,
}: {
  copyKey: string;
  copied: boolean;
  label: string;
  withLabel?: boolean;
  onCopy: (key: string) => Promise<void>;
}) {
  return (
    <button
      className={`copy-btn ${withLabel ? "with-label" : ""} ${copied ? "ok" : ""}`}
      data-copy-key={copyKey}
      title={label}
      aria-label={label}
      type="button"
      onClick={() => void onCopy(copyKey)}
    >
      <CopyIcon aria-hidden="true" focusable="false" />
      {withLabel ? <span>{label}</span> : null}
    </button>
  );
}

function ErrorShell({
  title,
  message,
  error = false,
}: {
  title: string;
  message: string;
  error?: boolean;
}) {
  return (
    <main className="debug-error-shell">
      <h1>{title}</h1>
      <p className={error ? "error" : ""}>{message}</p>
    </main>
  );
}

function getStorageKey(): string | null {
  const params = new URLSearchParams(window.location.search);
  const key = params.get("key");
  if (!key || key.trim().length === 0) return null;
  return key;
}

function getDefuddleMetaText(defuddle: NonNullable<DebugViewPayload["defuddle"]>): string {
  return [
    `Description: ${defuddle.description ?? "unknown"}`,
    `Word Count: ${typeof defuddle.wordCount === "number" ? defuddle.wordCount : "unknown"}`,
    `Parse Time: ${
      typeof defuddle.parseTime === "number" ? `${defuddle.parseTime}ms` : "unknown"
    }`,
  ].join("\n");
}

function getReadabilityMetaText(
  readability: NonNullable<DebugViewPayload["readability"]>
): string {
  return [
    `Title: ${readability.title ?? "unknown"}`,
    `Site: ${readability.siteName ?? "unknown"}`,
    `Byline: ${readability.byline ?? "unknown"}`,
    `Excerpt: ${readability.excerpt ?? "unknown"}`,
    `Length: ${typeof readability.length === "number" ? readability.length : "unknown"}`,
  ].join("\n");
}
