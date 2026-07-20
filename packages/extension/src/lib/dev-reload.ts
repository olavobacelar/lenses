export const DEV_CONTEXT_CHECK_MESSAGE_TYPE = "dev-context-check";

export function isExtensionContextInvalidatedMessage(message: unknown): boolean {
  return String(message ?? "")
    .toLowerCase()
    .includes("extension context invalidated");
}
