import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PopupApp } from "./PopupApp";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Missing popup root element.");
}

createRoot(rootElement).render(
  <StrictMode>
    <PopupApp />
  </StrictMode>
);
