import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type {
  EvidenceBase,
  EvidenceBaseDeletePreview,
  EvidenceBaseDetail,
  EvidenceBaseExport,
  EvidenceBaseFinding,
  EvidenceBaseRun,
  EvidenceBaseSource,
} from "@lenses/shared";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ChevronDown,
  ChevronRight,
  Clipboard,
  Download,
  ExternalLink,
  FileText,
  Globe2,
  LibraryBig,
  Pencil,
  Plus,
  Search,
  Trash2,
  TriangleAlert,
  Video,
  X,
} from "lucide-react";
import { initTheme } from "../lib/theme";
import { evidenceBaseExportFilename } from "../lib/evidence-bases";
import { isAppModeChangedMessage } from "../lib/app-mode";

type EditorInput = {
  title: string;
  description?: string;
  guidingQuestion?: string;
};

export function App() {
  const [evidenceBases, setEvidenceBases] = useState<EvidenceBase[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<EvidenceBaseDetail | null>(null);
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState<"create" | "edit" | null>(null);
  const [deletePreview, setDeletePreview] = useState<EvidenceBaseDeletePreview | null>(null);

  const loadDetail = useCallback(async (id: string) => {
    const response = await runtimeMessage<{ evidenceBase?: EvidenceBaseDetail; error?: string }>({
      type: "get-evidence-base",
      evidenceBaseId: id,
    });
    if (response.error || !response.evidenceBase) {
      throw new Error(response.error || "Could not load evidence base");
    }
    setDetail(response.evidenceBase);
    setExpandedSources((current) =>
      current.size > 0
        ? current
        : new Set(response.evidenceBase!.sources.slice(0, 1).map((source) => source.id))
    );
  }, []);

  const load = useCallback(
    async (preferredId?: string | null) => {
      setLoading(true);
      setError("");
      try {
        const response = await runtimeMessage<{ evidenceBases?: EvidenceBase[]; error?: string }>({
          type: "list-evidence-bases",
        });
        if (response.error) throw new Error(response.error);
        const next = response.evidenceBases ?? [];
        setEvidenceBases(next);
        const hashId = decodeHashId();
        const candidate = preferredId ?? hashId ?? selectedId;
        const nextId = next.some((item) => item.id === candidate) ? candidate! : next[0]?.id ?? null;
        setSelectedId(nextId);
        if (nextId) {
          if (hashId !== nextId) history.replaceState(null, "", `#${encodeURIComponent(nextId)}`);
          await loadDetail(nextId);
        } else {
          setDetail(null);
          history.replaceState(null, "", location.pathname);
        }
      } catch (caught) {
        setError(formatError(caught));
      } finally {
        setLoading(false);
      }
    },
    [loadDetail, selectedId]
  );

  useEffect(() => {
    initTheme({ fastCache: true });
    void load();
  }, []);

  useEffect(() => {
    const onHashChange = () => {
      const id = decodeHashId();
      if (!id || id === selectedId) return;
      setSelectedId(id);
      setLoading(true);
      void loadDetail(id)
        .catch((caught) => setError(formatError(caught)))
        .finally(() => setLoading(false));
    };
    const onRuntimeMessage = (message: unknown) => {
      if (isAppModeChangedMessage(message)) void load(null);
    };
    window.addEventListener("hashchange", onHashChange);
    chrome.runtime.onMessage.addListener(onRuntimeMessage);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
      chrome.runtime.onMessage.removeListener(onRuntimeMessage);
    };
  }, [load, loadDetail, selectedId]);

  const selectEvidenceBase = (id: string) => {
    if (id === selectedId) return;
    location.hash = encodeURIComponent(id);
  };

  const saveEvidenceBase = async (input: EditorInput) => {
    const response = await runtimeMessage<{ id?: string; error?: string }>({
      type: editor === "edit" ? "update-evidence-base" : "create-evidence-base",
      ...(editor === "edit" && detail ? { evidenceBaseId: detail.id } : null),
      ...input,
    });
    if (response.error || !response.id) throw new Error(response.error || "Could not save evidence base");
    setEditor(null);
    await load(response.id);
  };

  const inspectDelete = async () => {
    if (!detail) return;
    const response = await runtimeMessage<{ preview?: EvidenceBaseDeletePreview; error?: string }>({
      type: "preview-delete-evidence-base",
      evidenceBaseId: detail.id,
    });
    if (response.error || !response.preview) throw new Error(response.error || "Could not inspect deletion");
    setDeletePreview(response.preview);
  };

  const confirmDelete = async () => {
    if (!detail) return;
    const response = await runtimeMessage<{ deleted?: boolean; error?: string }>({
      type: "delete-evidence-base",
      evidenceBaseId: detail.id,
    });
    if (response.error || !response.deleted) throw new Error(response.error || "Could not delete evidence base");
    setDeletePreview(null);
    await load(null);
  };

  const exportBundle = async () => {
    if (!detail) return;
    const response = await runtimeMessage<{ bundle?: EvidenceBaseExport; error?: string }>({
      type: "export-evidence-base",
      evidenceBaseId: detail.id,
    });
    if (response.error || !response.bundle) throw new Error(response.error || "Could not export evidence base");
    downloadJson(response.bundle, evidenceBaseExportFilename(detail.title));
  };

  const visibleBases = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return query
      ? evidenceBases.filter((item) => item.title.toLowerCase().includes(query))
      : evidenceBases;
  }, [evidenceBases, filter]);

  // When a base has runs but every one failed/cancelled with no findings, it
  // reads as merely empty. Surface that instead. Returns the run count, or null.
  const failedRunCount = useMemo(() => (detail ? failureOnlyRunCount(detail) : null), [detail]);

  return (
    <main className="evidence-app">
      <aside className="evidence-sidebar">
        <div className="sidebar-brand">
          <span className="brand-mark" aria-hidden="true">
            <img
              src="../icons/icon-256.png"
              srcSet="../icons/icon-256.png 1x, ../icons/icon-512.png 2x"
              width="32"
              height="32"
              alt=""
            />
          </span>
          <span>Evidence Bases</span>
        </div>
        <button className="sidebar-new-base" type="button" onClick={() => setEditor("create")}>
          New evidence base
        </button>
        <label className="evidence-filter">
          <Search aria-hidden="true" />
          <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter evidence bases" />
        </label>
        <nav className="evidence-list" aria-label="Evidence bases">
          {visibleBases.map((item) => (
            <button key={item.id} className={item.id === selectedId ? "evidence-list-item is-active" : "evidence-list-item"} type="button" onClick={() => selectEvidenceBase(item.id)}>
              <span className="evidence-list-copy">
                <strong>{item.title}</strong>
                <span>{formatCount(item.sourceCount, "source")} · {formatCount(item.runCount, "run")}</span>
              </span>
            </button>
          ))}
          {!loading && visibleBases.length === 0 ? <p className="empty-list">No evidence bases</p> : null}
        </nav>
      </aside>

      <section className="evidence-main">
        {error ? <div className="error-banner" role="alert"><span>{error}</span><button className="icon-button" type="button" onClick={() => setError("")} aria-label="Dismiss" title="Dismiss"><X aria-hidden="true" /></button></div> : null}
        {loading && !detail ? <div className="empty-state">Loading...</div> : null}
        {!loading && !detail ? <div className="empty-state"><LibraryBig aria-hidden="true" /><h2>No evidence bases yet</h2><button className="primary-button" type="button" onClick={() => setEditor("create")}><Plus aria-hidden="true" />New evidence base</button></div> : null}
        {detail ? (
          <>
            <header className="detail-header">
              <div className="detail-heading">
                <h1>{detail.title}</h1>
                {detail.guidingQuestion ? <p className="guiding-question">{detail.guidingQuestion}</p> : null}
                {detail.description ? <p className="detail-description">{detail.description}</p> : null}
              </div>
              <div className="detail-actions">
                <button className="icon-button" type="button" title="Edit" aria-label="Edit" onClick={() => setEditor("edit")}><Pencil aria-hidden="true" /></button>
                <button className="icon-button" type="button" title="Export JSON" aria-label="Export JSON" onClick={() => void exportBundle().catch((caught) => setError(formatError(caught)))}><Download aria-hidden="true" /></button>
                <button className="icon-button danger-button" type="button" title="Delete" aria-label="Delete" onClick={() => void inspectDelete().catch((caught) => setError(formatError(caught)))}><Trash2 aria-hidden="true" /></button>
              </div>
            </header>
            <div className="detail-stats"><span>{formatCount(detail.sources.length, "source")}</span><span>{formatCount(detail.runCount, "run")} started here</span><span>Updated {formatDate(detail.updatedAt)}</span></div>
            {failedRunCount != null ? (
              <div className="base-alert" role="status">
                <TriangleAlert aria-hidden="true" />
                <span><strong>No findings yet — all {formatCount(failedRunCount, "run")} failed.</strong> Fix the cause and re-run this source to populate the base.</span>
              </div>
            ) : null}
            <section className="source-list" id="sources">
              <h2>Sources</h2>
              {detail.sources.map((source) => (
                <SourceRow
                  key={source.id}
                  source={source}
                  evidenceBaseId={detail.id}
                  expanded={expandedSources.has(source.id)}
                  onToggle={() => setExpandedSources((current) => toggleSetValue(current, source.id))}
                />
              ))}
              {detail.sources.length === 0 ? <p className="empty-sources">No sources captured</p> : null}
            </section>
          </>
        ) : null}
      </section>

      <EvidenceBaseEditor
        mode={editor}
        evidenceBase={editor === "edit" ? detail : null}
        onOpenChange={(open) => { if (!open) setEditor(null); }}
        onSave={saveEvidenceBase}
      />
      <DeleteDialog
        preview={deletePreview}
        title={detail?.title ?? ""}
        onOpenChange={(open) => { if (!open) setDeletePreview(null); }}
        onReview={() => {
          setDeletePreview(null);
          document.getElementById("sources")?.scrollIntoView({ behavior: "smooth" });
        }}
        onConfirm={confirmDelete}
        onError={(message) => setError(message)}
      />
    </main>
  );
}

function SourceRow({ source, evidenceBaseId, expanded, onToggle }: { source: EvidenceBaseSource; evidenceBaseId: string; expanded: boolean; onToggle: () => void }) {
  const SourceIcon = source.kind === "youtube_video" ? Video : source.kind === "pdf" ? FileText : Globe2;
  const linkable = !!source.url && /^https?:/i.test(source.url);
  return (
    <article className="source-row">
      <div className="source-row-head">
        <button className="source-toggle" type="button" onClick={onToggle} aria-expanded={expanded}>
          {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
          <SourceIcon aria-hidden="true" />
          <span>
            <strong>{source.title || source.url || "Untitled source"}</strong>
            <small>{sourceKindLabel(source.kind)} · {formatCount(source.runs.length, "run")}</small>
          </span>
        </button>
        {linkable ? <a className="icon-button" href={source.url} target="_blank" rel="noreferrer" aria-label="Open source" title="Open source"><ExternalLink aria-hidden="true" /></a> : null}
      </div>
      {expanded ? (
        <div className="source-body">
          {source.latestFingerprint ? (
            <div className="capture-line">
              <span>Captured {formatDate(source.latestFingerprint.observedAt)} · {formatCharacterCount(source.latestFingerprint.contentLength)}{ocrRequiredCount(source) > 0 ? ` · ${formatCount(ocrRequiredCount(source), "page")} requires OCR` : ""}</span>
              <button className="copy-button" type="button" title="Copy SHA-256 checksum" aria-label="Copy SHA-256 checksum" onClick={() => void navigator.clipboard.writeText(source.latestFingerprint!.contentHash)}><Clipboard aria-hidden="true" /></button>
            </div>
          ) : null}
          <div className="run-list">
            {groupRunsByLens(source.runs).map((group) => (
              <RunGroup key={group.latest.id} group={group} evidenceBaseId={evidenceBaseId} />
            ))}
            {source.runs.length === 0 ? <p className="empty-runs">No runs yet</p> : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}

// Repeat runs of the same lens collapse: the latest stays expanded, the rest
// fold behind an "N earlier attempts" disclosure so a source with a string of
// failed retries doesn't render as a wall of identical rows.
function RunGroup({ group, evidenceBaseId }: { group: RunGroupModel; evidenceBaseId: string }) {
  const [showEarlier, setShowEarlier] = useState(false);
  return (
    <>
      <RunRow run={group.latest} evidenceBaseId={evidenceBaseId} />
      {group.earlier.length > 0 ? (
        <div className="earlier-attempts">
          <button className="earlier-attempts-toggle" type="button" onClick={() => setShowEarlier((value) => !value)} aria-expanded={showEarlier}>
            {showEarlier ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
            {formatCount(group.earlier.length, "earlier attempt")}
          </button>
          {showEarlier ? (
            <div className="earlier-attempts-list">
              {group.earlier.map((run) => <RunRow key={run.id} run={run} evidenceBaseId={evidenceBaseId} defaultOpen={false} />)}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function RunRow({ run, evidenceBaseId, defaultOpen = true }: { run: EvidenceBaseRun; evidenceBaseId: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const reused = run.initiatedFromEvidenceBaseId !== evidenceBaseId;
  const coverage = runCoverageLabel(run);
  const errorInfo = classifyRunError(run);
  return (
    <section className="run-row">
      <button className="run-toggle" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        {open ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
        <span><strong>{lensLabel(run.lensId)}</strong><small>{formatCount(run.findings.length, "finding")}{coverage ? ` · ${coverage}` : ""} · {formatDate(run.createdAt)}{reused ? " · reused" : ""}</small></span>
        <span className={`run-status status-${run.status}`}>{runStatusLabel(run.status)}</span>
      </button>
      {open ? <div className="finding-list">{errorInfo ? <RunError info={errorInfo} /> : null}{run.findings.map((finding) => <FindingRow key={finding.id} finding={finding} />)}{run.findings.length === 0 && !errorInfo ? <p>No findings</p> : null}</div> : null}
    </section>
  );
}

// A run error is never shown raw — request IDs, stack frames, and handler paths
// stay out of the UI. We map the underlying error to a plain-language cause and,
// where the user can fix it, an action. Amber for user-fixable, red otherwise.
function RunError({ info }: { info: RunErrorInfo }) {
  return (
    <div className={info.tone === "warn" ? "run-error is-warn" : "run-error"}>
      <TriangleAlert aria-hidden="true" />
      <div className="run-error-body">
        <span className="run-error-title">{info.title}</span>
        {info.action ? (
          <button className="run-error-action" type="button" onClick={openSettings}>{info.action} →</button>
        ) : null}
      </div>
    </div>
  );
}

function FindingRow({ finding }: { finding: EvidenceBaseFinding }) {
  return (
    <article className="finding-row">
      <div className="finding-meta"><span>{finding.category}</span><span>{Math.round(finding.confidence * 100)}%</span>{anchorLabel(finding) ? <span>{anchorLabel(finding)}</span> : null}</div>
      <strong>{finding.text}</strong>
      {finding.detail ? <p>{finding.detail}</p> : null}
      {finding.quotes?.map((quote, index) => <blockquote key={`${finding.id}:${index}`}>{quote}</blockquote>)}
    </article>
  );
}

function EvidenceBaseEditor({ mode, evidenceBase, onOpenChange, onSave }: { mode: "create" | "edit" | null; evidenceBase: EvidenceBaseDetail | null; onOpenChange: (open: boolean) => void; onSave: (input: EditorInput) => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [guidingQuestion, setGuidingQuestion] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!mode) return;
    setTitle(evidenceBase?.title ?? "");
    setDescription(evidenceBase?.description ?? "");
    setGuidingQuestion(evidenceBase?.guidingQuestion ?? "");
    setError("");
  }, [evidenceBase, mode]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSave({ title: title.trim(), description: description.trim() || undefined, guidingQuestion: guidingQuestion.trim() || undefined });
    } catch (caught) {
      setError(formatError(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Root open={mode != null} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          <div className="dialog-head"><div className="dialog-heading"><Dialog.Title>{mode === "edit" ? "Edit evidence base" : "New evidence base"}</Dialog.Title><Dialog.Description className="dialog-subtitle">{mode === "edit" ? "Update this evidence base's details." : "Group related sources into one evidence workspace."}</Dialog.Description></div><Dialog.Close asChild><button className="icon-button" type="button" aria-label="Close" title="Close"><X aria-hidden="true" /></button></Dialog.Close></div>
          <form className="editor-form" onSubmit={submit}>
            <label><span>Title</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} required autoFocus /></label>
            <label><span>Description</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} rows={3} /></label>
            <label><span>Guiding question</span><textarea value={guidingQuestion} onChange={(event) => setGuidingQuestion(event.target.value)} maxLength={1000} rows={2} /></label>
            {error ? <p className="form-error">{error}</p> : null}
            <div className="dialog-actions"><Dialog.Close asChild><button className="secondary-button" type="button">Cancel</button></Dialog.Close><button className="primary-button" type="submit" disabled={saving}>{saving ? "Saving..." : mode === "edit" ? "Save changes" : "Create"}</button></div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DeleteDialog({ preview, title, onOpenChange, onReview, onConfirm, onError }: { preview: EvidenceBaseDeletePreview | null; title: string; onOpenChange: (open: boolean) => void; onReview: () => void; onConfirm: () => Promise<void>; onError: (message: string) => void }) {
  const [deleting, setDeleting] = useState(false);
  return (
    <Dialog.Root open={preview != null} onOpenChange={onOpenChange}>
      <Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content delete-dialog">
        <div className="dialog-head"><Dialog.Title>Delete {title}?</Dialog.Title><Dialog.Close asChild><button className="icon-button" type="button" aria-label="Close" title="Close"><X aria-hidden="true" /></button></Dialog.Close></div>
        {preview ? <div className="delete-summary"><p>{preview.sourceMemberships} source references and {preview.initiatedRuns} runs were created in this evidence base.</p><dl><div><dt>Sources deleted</dt><dd>{preview.sourcesDeleted}</dd></div><div><dt>Shared sources retained</dt><dd>{preview.sharedSources}</dd></div><div><dt>Runs deleted</dt><dd>{preview.runsDeleted}</dd></div><div><dt>Reusable runs retained</dt><dd>{preview.runsRetained}</dd></div><div><dt>Findings deleted</dt><dd>{preview.findingsDeleted}</dd></div></dl><a href={location.hash || "#"} onClick={(event) => { event.preventDefault(); onReview(); }}>Review evidence base</a></div> : null}
        <div className="dialog-actions"><Dialog.Close asChild><button className="secondary-button" type="button">Cancel</button></Dialog.Close><button className="delete-button" type="button" disabled={deleting} onClick={() => { setDeleting(true); void onConfirm().catch((caught) => onError(formatError(caught))).finally(() => setDeleting(false)); }}>{deleting ? "Deleting..." : "Delete"}</button></div>
      </Dialog.Content></Dialog.Portal>
    </Dialog.Root>
  );
}

function runtimeMessage<T>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(response as T);
    });
  });
}

function decodeHashId(): string | null {
  if (!location.hash.slice(1)) return null;
  try { return decodeURIComponent(location.hash.slice(1)); } catch { return null; }
}

function downloadJson(value: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function toggleSetValue(current: Set<string>, value: string): Set<string> {
  const next = new Set(current);
  if (next.has(value)) next.delete(value); else next.add(value);
  return next;
}

function sourceKindLabel(kind: EvidenceBaseSource["kind"]): string {
  if (kind === "youtube_video") return "YouTube video";
  if (kind === "pdf") return "PDF";
  return "Web page";
}

function lensLabel(id: string): string { return humanize(id.replace(/^custom[-_:]?/i, "")); }
function humanize(value: string): string { return value.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()); }
function formatError(value: unknown): string { return value instanceof Error ? value.message : String(value); }
function formatDate(value: number): string { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(value); }
function formatCharacterCount(value: number): string { return `${new Intl.NumberFormat().format(value)} characters`; }
function formatCount(value: number, noun: string): string { return `${new Intl.NumberFormat().format(value)} ${noun}${value === 1 ? "" : "s"}`; }

function ocrRequiredCount(source: EvidenceBaseSource): number {
  return new Set(
    latestSourceSegments(source)
      .filter(
        (segment) =>
          segment.extractionStatus === "ocr_required" && segment.anchor.kind === "pdf"
      )
      .map((segment) =>
        segment.anchor.kind === "pdf" ? segment.anchor.pageNumber : segment.segmentKey
      )
  ).size;
}

function latestSourceSegments(source: EvidenceBaseSource) {
  const fingerprintId = source.latestFingerprint?.id;
  return fingerprintId
    ? source.segments.filter((segment) => segment.sourceFingerprintId === fingerprintId)
    : source.segments;
}

function runCoverageLabel(run: EvidenceBaseRun): string {
  const core = run.segmentManifest.filter((inspection) => inspection.role === "core");
  if (core.length === 0) return "";
  const completed = core.filter((inspection) => inspection.status === "completed").length;
  return `${completed}/${core.length} segments inspected`;
}

// A cancelled run is a run the user stopped; the sidepanel already calls that
// "Stopped", so the library pill uses the same word. The status-cancelled class
// hook (and its styling) is unchanged — only the label differs.
function runStatusLabel(status: EvidenceBaseRun["status"]): string {
  return status === "cancelled" ? "Stopped" : status;
}

type RunGroupModel = { latest: EvidenceBaseRun; earlier: EvidenceBaseRun[] };

// Group a source's runs by lens, preserving newest-first order. Runs arrive
// newest-first, so the first run seen for a lens is its latest; the rest are
// earlier attempts.
function groupRunsByLens(runs: EvidenceBaseRun[]): RunGroupModel[] {
  const order: string[] = [];
  const byLens = new Map<string, EvidenceBaseRun[]>();
  for (const run of runs) {
    if (!byLens.has(run.lensId)) {
      byLens.set(run.lensId, []);
      order.push(run.lensId);
    }
    byLens.get(run.lensId)!.push(run);
  }
  return order.map((lensId) => {
    const list = byLens.get(lensId)!;
    return { latest: list[0], earlier: list.slice(1) };
  });
}

function failureOnlyRunCount(detail: EvidenceBaseDetail): number | null {
  const runs = detail.sources.flatMap((source) => source.runs);
  if (runs.length === 0) return null;
  const anyFindings = runs.some((run) => run.findings.length > 0);
  const allFailed = runs.every((run) => run.status === "failed" || run.status === "cancelled");
  return allFailed && !anyFindings ? runs.length : null;
}

type RunErrorInfo = { tone: "warn" | "danger"; title: string; action?: string };

// Map a run's raw error to a friendly, actionable message. User-fixable causes
// (missing/invalid key, quota, rate limit) are amber warnings with a Settings
// action; everything else is a generic red failure. The raw text — request IDs,
// stack frames, handler paths — is never returned.
function classifyRunError(run: EvidenceBaseRun): RunErrorInfo | null {
  if (run.status === "cancelled") {
    return { tone: "warn", title: "Run cancelled before it finished." };
  }
  if (run.status !== "failed") return null;

  const raw = (run.error ?? "").toLowerCase();
  const provider = /anthropic/.test(raw) ? "Anthropic" : /openai/.test(raw) ? "OpenAI" : null;

  if (/no .*api key configured|api key (?:is )?not configured|missing .*api key/.test(raw)) {
    return {
      tone: "warn",
      title: provider ? `This lens needs an ${provider} API key.` : "This lens needs an API key.",
      action: provider ? `Add an ${provider} key in Settings` : "Open Settings",
    };
  }
  if (/authentication_error|api key is invalid|invalid api key|unauthorized|\b401\b/.test(raw)) {
    return {
      tone: "warn",
      title: provider
        ? `Your ${provider} API key was rejected — it may be invalid or expired.`
        : "The API key was rejected — it may be invalid or expired.",
      action: provider ? `Update your ${provider} key in Settings` : "Open Settings",
    };
  }
  if (/insufficient_quota|exceeded your.*quota|billing|payment required|\b402\b/.test(raw)) {
    return {
      tone: "warn",
      title: provider
        ? `Your ${provider} account is out of quota or has a billing issue.`
        : "The model provider reports an out-of-quota or billing issue.",
      action: "Open Settings",
    };
  }
  if (/\b429\b|rate.?limit|too many requests/.test(raw)) {
    return { tone: "warn", title: "The model provider is rate-limiting requests. Wait a moment, then re-run." };
  }
  return { tone: "danger", title: "This run failed. Try running it again." };
}

function openSettings(): void {
  void chrome.tabs.create({ url: chrome.runtime.getURL("settings.html#ai") });
}

function anchorLabel(finding: EvidenceBaseFinding): string {
  const anchor = finding.anchor;
  if (!anchor || typeof anchor !== "object") return "";
  if (anchor.kind === "pdf") return `Page ${anchor.pageLabel ?? anchor.pageNumber}`;
  if (anchor.kind === "transcript") return anchor.formatted ?? "";
  if (finding.sourceSpan) return `Chars ${finding.sourceSpan.start}-${finding.sourceSpan.end}`;
  return "";
}
