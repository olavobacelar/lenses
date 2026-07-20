import { describe, it, expect } from "vitest";
import {
  DEFAULT_THEME_PREFERENCE,
  isThemePreference,
  nextThemePreference,
  resolveEffectiveTheme,
} from "../src/lib/theme";

describe("resolveEffectiveTheme", () => {
  it("honors an explicit dark preference regardless of system", () => {
    expect(resolveEffectiveTheme("dark", false)).toBe("dark");
    expect(resolveEffectiveTheme("dark", true)).toBe("dark");
  });

  it("honors an explicit light preference regardless of system", () => {
    expect(resolveEffectiveTheme("light", false)).toBe("light");
    expect(resolveEffectiveTheme("light", true)).toBe("light");
  });

  it("follows the system setting when preference is system", () => {
    expect(resolveEffectiveTheme("system", true)).toBe("dark");
    expect(resolveEffectiveTheme("system", false)).toBe("light");
  });
});

describe("isThemePreference", () => {
  it("accepts the three valid preferences", () => {
    expect(isThemePreference("light")).toBe(true);
    expect(isThemePreference("dark")).toBe(true);
    expect(isThemePreference("system")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isThemePreference("")).toBe(false);
    expect(isThemePreference("auto")).toBe(false);
    expect(isThemePreference(null)).toBe(false);
    expect(isThemePreference(undefined)).toBe(false);
    expect(isThemePreference(0)).toBe(false);
  });

  it("defaults to system", () => {
    expect(DEFAULT_THEME_PREFERENCE).toBe("system");
    expect(isThemePreference(DEFAULT_THEME_PREFERENCE)).toBe(true);
  });
});

describe("nextThemePreference", () => {
  it("cycles system -> light -> dark -> system", () => {
    expect(nextThemePreference("system")).toBe("light");
    expect(nextThemePreference("light")).toBe("dark");
    expect(nextThemePreference("dark")).toBe("system");
  });
});
