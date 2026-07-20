export const CHAT_ACTIONS_USE_SIDE_PANEL_KEY = "chatActions:useSidePanel";

export function chatActionsUseSidePanelFromStorage(
  value: Record<string, unknown>
): boolean {
  return value[CHAT_ACTIONS_USE_SIDE_PANEL_KEY] === true;
}
