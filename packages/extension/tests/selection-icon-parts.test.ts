import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SELECTION_PRIMARY_ACTIONS,
  SelectionTriggerContent,
  type SelectionIconName,
} from "../src/content/SelectionTrigger.js";

const EXPECTED_ICONS: SelectionIconName[] = ["ask", "explain", "truth", "summarize"];

describe("SelectionTriggerContent", () => {
  it("defines a Radix-backed icon action for every selection mode", () => {
    expect(SELECTION_PRIMARY_ACTIONS.map((action) => action.mode).sort()).toEqual(
      [...EXPECTED_ICONS].sort()
    );
  });

  it("renders the expected labels, shortcut hints, and icon elements", () => {
    const html = renderToStaticMarkup(
      createElement(SelectionTriggerContent, {
        disabled: false,
        onPrimaryAction: () => {},
      })
    );

    for (const action of SELECTION_PRIMARY_ACTIONS) {
      expect(html).toContain(action.label);
      expect(html).toContain(`>${action.keyHint}<`);
    }
    expect(html.match(/lenses-selection-trigger-icon/g)).toHaveLength(
      SELECTION_PRIMARY_ACTIONS.length
    );
  });
});
