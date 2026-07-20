import { describe, expect, it } from "vitest";
import { createThirdPartyNotices } from "../third-party-notices";

describe("third-party notices", () => {
  it("includes installed direct dependency metadata and upstream notices", () => {
    const notices = createThirdPartyNotices(new URL("..", import.meta.url).pathname);

    expect(notices).toMatch(/@mozilla\/readability@[^ ]+ — Apache-2\.0/);
    expect(notices).toMatch(/\n- react@[^ ]+ — MIT/);
    expect(notices).toContain("Dexie.js");
    expect(notices).toContain("Copyright (c) 2014-2017 David Fahlander");
  });
});
