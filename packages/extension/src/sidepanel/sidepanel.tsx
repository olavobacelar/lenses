import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { connectSourcePanelPresence } from "./lib/panel-presence";

// Let the worker know this panel is open (and in which window) so the page dock
// can toggle it closed in a single click.
connectSourcePanelPresence();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Missing sidepanel root element.");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
