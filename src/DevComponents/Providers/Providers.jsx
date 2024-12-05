import React from "react";
// Import the Alert if you have it
import Alert, { AlertProvider } from "./Alert";

export const AppProviders = ({ children }) => {
  return <AlertProvider>{children}</AlertProvider>;
};
