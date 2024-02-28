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
import Edusim from "./pages/edusim";
import Vxnessa from "./pages/vxnessa";
import Marz from "./pages/marz";
import About from "./pages/about";
import Contact from "./pages/contact";
import Chadmin from "./pages/chadmin";
import AlertProvider from "./Components/Alert/AlertProvider";
import Alert from "./Components/Alert/Alert";

const router = createBrowserRouter([
  {
    path: "/",
    Component: Landing,
  },
  {
    path: "work",
    Component: Work,
  },
  {
    path: "edusim",
    Component: Edusim,
  },
  {
    path: "vxnessa",
    Component: Vxnessa,
  },
  {
    path: "marz",
    Component: Marz,
  },
  {
    path: "about",
    Component: About,
  },
  {
    path: "contact",
    Component: Contact,
  },
  {
    path: "chadmin",
    Component: Chadmin,
  },
]);

createRoot(document.getElementById("root")).render(
  <AlertProvider>
    <Alert />
    <RouterProvider router={router} />
  </AlertProvider>
);
