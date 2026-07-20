import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DebugViewApp } from "./DebugViewApp";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Missing debug view root element.");
}

createRoot(rootElement).render(
  <StrictMode>
    <DebugViewApp />
  </StrictMode>
);
