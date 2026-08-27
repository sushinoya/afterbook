import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { AppView } from "./app/app-view.js";
import "./app/styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Afterbook could not find the application root.");
}

createRoot(rootElement).render(
  <StrictMode>
    <AppView />
  </StrictMode>,
);
