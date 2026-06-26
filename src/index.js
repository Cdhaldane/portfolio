import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter as Router } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { AppProviders } from "./DevComponents/Providers/Providers";
import Alert from "./DevComponents/Providers/Alert";
import App from "./App";

const container = document.getElementById("root");
const root = createRoot(container);
root.render(
  <HelmetProvider>
    <Router>
      <AppProviders>
        <Alert />
        <App />
      </AppProviders>
    </Router>
  </HelmetProvider>
);
