// Name of the long-lived port the side panel document opens against the service
// worker to signal that it is open. The window id is appended after the colon
// (e.g. "source-panel-presence:42") so the worker learns which window the panel
// belongs to synchronously when the port connects. Shared so the panel and the
// worker agree on the exact name without coupling their bundles.
export const SOURCE_PANEL_PRESENCE_PORT = "source-panel-presence";
