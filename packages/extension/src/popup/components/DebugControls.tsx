import { POPUP_FIXTURES } from "../constants";
import type { PopupFixture } from "../types";
import { ToggleRow } from "./ToggleRow";

export function DebugControls({
  visible,
  storePageLenses,
  testSourceMaxCitations,
  testSourceUseCache,
  busy,
  onStorePageLensesChange,
  onMaxCitationsChange,
  onUseCacheChange,
  onRenewSourceCache,
  onClearPageStorage,
  onOpenFixture,
  onCopyFixturePath,
  onCopyFixtureText,
}: {
  visible: boolean;
  storePageLenses: boolean;
  testSourceMaxCitations: number;
  testSourceUseCache: boolean;
  busy: Record<string, boolean>;
  onStorePageLensesChange: (checked: boolean) => void;
  onMaxCitationsChange: (value: string) => void;
  onUseCacheChange: (checked: boolean) => void;
  onRenewSourceCache: () => Promise<void>;
  onClearPageStorage: () => Promise<void>;
  onOpenFixture: (fixture: PopupFixture) => Promise<void>;
  onCopyFixturePath: (fixture: PopupFixture) => Promise<void>;
  onCopyFixtureText: (fixture: PopupFixture) => Promise<void>;
}) {
  return (
    <section id="debug-controls" className={`debug-controls ${visible ? "" : "hidden"}`}>
      <ToggleRow
        id="store-page-lenses"
        title="Store lenses for this page"
        checked={storePageLenses}
        onChange={onStorePageLensesChange}
      />

      <section className="test-settings">
        <p className="test-settings-title">Test mode source checks</p>

        <label className="test-field-row" htmlFor="test-source-max-citations">
          <span className="test-field-label">Max citations</span>
          <input
            type="number"
            id="test-source-max-citations"
            min={1}
            max={10}
            step={1}
            value={testSourceMaxCitations}
            onChange={(event) => onMaxCitationsChange(event.target.value)}
          />
        </label>

        <ToggleRow
          id="test-source-use-cache"
          title="Use cached source checks"
          checked={testSourceUseCache}
          onChange={onUseCacheChange}
        />

        <button
          id="renew-source-cache"
          className="debug-link"
          type="button"
          disabled={busy["renew-source-cache"]}
          onClick={() => void onRenewSourceCache()}
        >
          Renew source cache
        </button>
      </section>

      <section className="test-settings">
        <p className="test-settings-title">Test fixtures</p>
        <div id="test-fixture-list" className="fixture-list">
          {POPUP_FIXTURES.map((fixture) => (
            <FixtureItem
              key={fixture.id}
              fixture={fixture}
              busy={busy}
              onOpen={onOpenFixture}
              onCopyPath={onCopyFixturePath}
              onCopyText={onCopyFixtureText}
            />
          ))}
        </div>
      </section>

      <button
        id="clear-page-storage"
        className="debug-action"
        type="button"
        disabled={busy["clear-page-storage"]}
        onClick={() => void onClearPageStorage()}
      >
        Delete stored lenses for this page
      </button>
    </section>
  );
}

function FixtureItem({
  fixture,
  busy,
  onOpen,
  onCopyPath,
  onCopyText,
}: {
  fixture: PopupFixture;
  busy: Record<string, boolean>;
  onOpen: (fixture: PopupFixture) => Promise<void>;
  onCopyPath: (fixture: PopupFixture) => Promise<void>;
  onCopyText: (fixture: PopupFixture) => Promise<void>;
}) {
  return (
    <article className="fixture-item">
      <p className="fixture-title">{fixture.title}</p>
      <p className="fixture-path">{fixture.repoPath}</p>
      <div className="fixture-actions">
        <button
          type="button"
          className="fixture-action-btn"
          disabled={busy[`fixture:${fixture.id}:open`]}
          onClick={() => void onOpen(fixture)}
        >
          Open
        </button>
        <button
          type="button"
          className="fixture-action-btn"
          disabled={busy[`fixture:${fixture.id}:path`]}
          onClick={() => void onCopyPath(fixture)}
        >
          Copy path
        </button>
        <button
          type="button"
          className="fixture-action-btn"
          disabled={busy[`fixture:${fixture.id}:text`]}
          onClick={() => void onCopyText(fixture)}
        >
          Copy text
        </button>
      </div>
    </article>
  );
}
