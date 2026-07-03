import { lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import Spinner from "./DevComponents/Spinner/Spinner";
import ThemeSwitch from "./DevComponents/ThemeSwitch/ThemeSwitch";
import AppSidebar from "./Components/AppSidebar/AppSidebar";
import DashboardGate from "./Pages/Dashboard/DashboardGate";
import CommandPalette from "./Components/CommandPalette/CommandPalette";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";

import "./App.css";

// Code-split each route so the initial bundle stays small.
const LandingPage = lazy(() => import("./Pages/Landing/Landing"));
const WorkPage = lazy(() => import("./Pages/Work/Work"));
const AboutPage = lazy(() => import("./Pages/About/About"));
const ContactPage = lazy(() => import("./Pages/Contact/Contact"));
const Showcase = lazy(() => import("./Pages/Showcase/Showcase"));
const Dashboard = lazy(() => import("./Pages/Dashboard/Dashboard"));
const ImposterGame = lazy(() =>
  import("./Pages/Dashboard/ImposterGame/ImposterGame")
);
const MiniCrossword = lazy(() =>
  import("./Pages/Dashboard/MiniCrossword/MiniCrossword")
);
const Wavelength = lazy(() => import("./Pages/Dashboard/Wavelength/Wavelength"));
const Fishbowl = lazy(() => import("./Pages/Dashboard/Fishbowl/Fishbowl"));
const Services = lazy(() => import("./Pages/Services/Services"));
const Edusim = lazy(() => import("./Pages/Work/Edusim"));
const Vxnessa = lazy(() => import("./Pages/Work/Vxnessa"));
const Marz = lazy(() => import("./Pages/Work/Marz"));
const Timeslot = lazy(() => import("./Pages/Work/Timeslot"));
const NotFound = lazy(() => import("./Pages/NotFound/NotFound"));
const Guestbook = lazy(() => import("./Pages/Guestbook/Guestbook"));
const Writing = lazy(() => import("./Pages/Writing/Writing"));
const Post = lazy(() => import("./Pages/Writing/Post"));

const App = () => {
  return (
    <div className="main">
      <ThemeSwitch className="global-theme" />
      <AppSidebar />
      <Analytics />
      <SpeedInsights />
      <CommandPalette />
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/services" element={<Services />} />
          <Route path="/work" element={<WorkPage />} />
          <Route path="/work/edusim" element={<Edusim />} />
          <Route path="/work/vxnessa" element={<Vxnessa />} />
          <Route path="/work/marz" element={<Marz />} />
          <Route path="/work/timeslot" element={<Timeslot />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/showcase" element={<Showcase />} />
          <Route path="/guestbook" element={<Guestbook />} />
          <Route path="/writing" element={<Writing />} />
          <Route path="/writing/:slug" element={<Post />} />
          <Route path="/dashboard" element={<DashboardGate />}>
            <Route index element={<Dashboard />} />
            <Route path="imposter" element={<ImposterGame />} />
            <Route path="crossword" element={<MiniCrossword />} />
            <Route path="wavelength" element={<Wavelength />} />
            <Route path="fishbowl" element={<Fishbowl />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </div>
  );
};

export default App;
