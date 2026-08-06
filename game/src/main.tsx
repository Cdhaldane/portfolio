/*
 * main.tsx — the entry point.
 *
 * Deliberately tiny. All it does is mount the React shell; the shell owns the
 * canvas and constructs the Game, which owns the loop. Keeping the boundary here
 * means the game can later be embedded, headless-captured for attract mode, or
 * driven by a replay without touching this file.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./ui/App.tsx";

const host = document.getElementById("root");
if (!host) throw new Error("missing #root");

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
