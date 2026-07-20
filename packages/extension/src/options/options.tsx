import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { OptionsApp } from "./OptionsApp";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Missing settings root element.");
}

createRoot(rootElement).render(
  <StrictMode>
    <OptionsApp />
  </StrictMode>
);
