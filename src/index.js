import React from "react";
import { createRoot } from "react-dom/client";
import { HashRouter as Router } from "react-router-dom";
import { AppProviders } from "./DevComponents/Providers/Providers";
import Alert from "./DevComponents/Providers/Alert";
import App from "./App";

const container = document.getElementById("root");
const root = createRoot(container);
root.render(
  <Router>
    <AppProviders>
      <Alert />
      <App />
    </AppProviders>
  </Router>
);
