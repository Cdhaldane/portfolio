import React from "react";
import { useNavigate } from "react-router-dom";

import "./Navbar.css";

const Navbar = ({ links, isCollapsed, isPortrait }) => {
  const navigate = useNavigate();

  return (
    <nav
      className={`navbar ${isCollapsed ? "collapsed" : ""} ${
        isPortrait ? "portrait" : ""
      }`}
    >
      <h1 onClick={() => navigate("./admin")}>CH DEV PORTAL</h1>
      <ul>
        <li>
          <a onClick={() => navigate("/")}>
            <i class="fa-solid fa-house"></i>
          </a>
        </li>
        <li>
          <a onClick={() => navigate()}>
            <i class="fa-solid fa-circle-info"></i>
          </a>
        </li>
        <li>
          <a onClick={() => navigate()}>
            <i class="fa-solid fa-message"></i>
          </a>
        </li>
        <li>
          <a onClick={() => navigate("login")}>
            <i class="fa-solid fa-right-to-bracket"></i>
          </a>
        </li>
      </ul>
    </nav>
  );
};

export default Navbar;
