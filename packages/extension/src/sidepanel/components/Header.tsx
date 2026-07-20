import { ReloadIcon } from "@radix-ui/react-icons";
import type { UnsupportedSourcePage } from "../../lib/source-panel-url";
import type { PanelSource } from "../types";

interface HeaderProps {
  source: PanelSource | null;
  unsupportedPage: UnsupportedSourcePage | null;
  isLoading: boolean;
  onReload: () => void;
}

/* The page row of the top bar: just the (demoted) page title plus its one
   page-scoped action, reload, which stays invisible until the row is hovered
   or focused. Global chrome (library, new base, settings) lives in the base
   row above. */
export function Header({ source, unsupportedPage, isLoading, onReload }: HeaderProps) {
  // Blank titles are real data (Chrome's PDF embedder page reports ""), so the
  // fallback triggers on whitespace too — the reload action must never sit
  // beside an empty heading. Without a source at all, the heading says what is
  // actually happening: still loading, or nothing loadable ("Untitled").
  const isAwaitingSource = isLoading && !source && !unsupportedPage;
  const title =
    (unsupportedPage?.title ?? source?.title)?.trim() ||
    (isAwaitingSource ? "Loading source..." : "Untitled");

  return (
    <header className="source-header">
      <div className="source-title-block">
        <h1 id="source-title">{title}</h1>
      </div>
      <div className="header-actions">
        <button
          id="reload-source"
          className="icon-btn"
          type="button"
          data-tooltip="Reload source"
          aria-label="Reload source"
          onClick={onReload}
        >
          <ReloadIcon aria-hidden="true" focusable="false" />
        </button>
      </div>
    </header>
  );
}
