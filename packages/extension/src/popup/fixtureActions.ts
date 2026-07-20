import { POPUP_FIXTURES } from "./constants";
import { createTab } from "./chromeBase";
import type { PopupFixture } from "./types";

const fixtureTextCache = new Map<string, string>();

export async function loadFixtureText(fixture: PopupFixture): Promise<string> {
  if (!__INTERNAL_TOOLS__) return "";
  const cached = fixtureTextCache.get(fixture.id);
  if (cached) return cached;

  const response = await fetch(chrome.runtime.getURL(fixture.bundlePath));
  if (!response.ok) {
    throw new Error(`Fixture load failed (${response.status})`);
  }

  const text = await response.text();
  fixtureTextCache.set(fixture.id, text);
  return text;
}

export function openFixtureInNewTab(fixture: PopupFixture): Promise<void> {
  if (!__INTERNAL_TOOLS__) return Promise.resolve();
  return createTab(chrome.runtime.getURL(fixture.bundlePath));
}

export async function copyFixturePath(fixture: PopupFixture): Promise<void> {
  if (!__INTERNAL_TOOLS__) return;
  await navigator.clipboard.writeText(fixture.repoPath);
}

export async function copyFixtureText(fixture: PopupFixture): Promise<void> {
  if (!__INTERNAL_TOOLS__) return;
  const text = await loadFixtureText(fixture);
  await navigator.clipboard.writeText(text);
}

export function getFixtureById(id: string): PopupFixture | null {
  if (!__INTERNAL_TOOLS__) return null;
  return POPUP_FIXTURES.find((fixture) => fixture.id === id) ?? null;
}
