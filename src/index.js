import * as React from "react";
import { createRoot } from "react-dom/client";
import {
  createBrowserRouter,
  RouterProvider,
  Route,
  Link,
} from "react-router-dom";
import Landing from "./pages/landing";
import Work from "./pages/work";
import WorkPage from "./pages/work-page";

const router = createBrowserRouter([
  {
    path: "/",
    Component: Landing
  },
  {
    path: "work",
    Component: Work
  },
  {
    path: "work/:id",
    Component: WorkPage
  },
]);

createRoot(document.getElementById("root")).render(
  <RouterProvider router={router} />
);