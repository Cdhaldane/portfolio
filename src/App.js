import React, { useEffect } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  useLocation,
} from "react-router-dom";
import LandingPage from "./Pages/Landing/Landing";
import WorkPage from "./Pages/Work/Work";
import AboutPage from "./Pages/About/About";
import ContactPage from "./Pages/Contact/Contact";
import Showcase from "./Pages/Showcase/Showcase";

import Edusim from "./Pages/Work/Edusim";
import Vxnessa from "./Pages/Work/Vxnessa";
import Marz from "./Pages/Work/Marz";
import Timeslot from "./Pages/Work/Timeslot";

import "./App.css";

const App = () => {
  const location = useLocation();

  const SideBar = () => {
    let locationStyle = "";
    if (location.pathname === "/work" || location.pathname === "/showcase")
      locationStyle = "work";
    else if (location.pathname === "/about") locationStyle = "about";
    return (
      <>
        <div className={`black-box ${locationStyle}`}></div>
        <div className={`side-box ${locationStyle}`}>
          {location.pathname !== "" && (
            <a>
              <a href="/">HOME</a>
            </a>
          )}
          <a href="https://github.com/Cdhaldane">GH</a>
          <a href="https://www.linkedin.com/in/charliehaldaneuottawa/">LI</a>
          <a href="https://www.instagram.com/charliedhaldane/">IG</a>
          <div
            className="vertical-line"
            style={{
              borderLeft: location.pathname.includes("marz")
                ? "1px solid red"
                : location.pathname.includes("vxnessa")
                ? "1px solid purple"
                : location.pathname.includes("timeslot")
                ? "1px solid #88f188"
                : location.pathname.includes("edusim")
                ? "1px solid #8f001a"
                : "1px solid var(--primary)",
            }}
          ></div>
          <a>©/2023</a>
        </div>
      </>
    );
  };

  return (
    <div className="main">
      <SideBar />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/work" element={<WorkPage />} />
        <Route path="/work/edusim" element={<Edusim />} />
        <Route path="/work/vxnessa" element={<Vxnessa />} />
        <Route path="/work/marz" element={<Marz />} />
        <Route path="/work/timeslot" element={<Timeslot />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/showcase" element={<Showcase />} />
      </Routes>
    </div>
  );
};

export default App;
