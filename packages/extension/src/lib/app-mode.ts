import { readMigratedAppAccessMode } from "./legacy-storage-compat";

export const APP_ACCESS_MODE_STORAGE_KEY = "appAccessMode";
export const APP_MODE_CHANGED_MESSAGE_TYPE = "app-mode:changed";

export type AppAccessMode = "managed" | "local_byok";

export const DEFAULT_APP_ACCESS_MODE: AppAccessMode = "managed";

export interface AppModeChangedMessage {
  type: typeof APP_MODE_CHANGED_MESSAGE_TYPE;
  mode: AppAccessMode;
}

export function parseAppAccessMode(value: unknown): AppAccessMode {
  return value === "managed" || value === "local_byok"
    ? value
    : DEFAULT_APP_ACCESS_MODE;
}

export async function readAppAccessMode(): Promise<AppAccessMode> {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    return DEFAULT_APP_ACCESS_MODE;
  }

  try {
    return parseAppAccessMode(
      await readMigratedAppAccessMode(APP_ACCESS_MODE_STORAGE_KEY)
    );
  } catch {
    return DEFAULT_APP_ACCESS_MODE;
  }
}

export function isLocalByokMode(mode: AppAccessMode): boolean {
  return mode === "local_byok";
}

export function isAppModeChangedMessage(value: unknown): value is AppModeChangedMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<AppModeChangedMessage>;
  return (
    message.type === APP_MODE_CHANGED_MESSAGE_TYPE &&
    (message.mode === "managed" || message.mode === "local_byok")
  );
}
