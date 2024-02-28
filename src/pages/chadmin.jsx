import "./chadmin.css";

import React, { useState, useEffect } from "react";

import Button from "../Components/Button/Button";
import Navbar from "../Components/Navbar/Navbar";
import Sidebar from "../Components/Sidebar/Sidebar";
import Login from "../Components/Login/Login";
import ThemeSwitch from "../Components/ThemeSwitch/ThemeSwitch";
import Alert from "../Components/Alert/Alert";
import { AlertProvider } from "../Components/Alert/AlertProvider";
import { useAlert } from "../Components/Alert/AlertProvider";
import Modal from "../Components/Modal/Modal";

function CHLayout() {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isPortrait, setIsPortrait] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const { showAlert } = useAlert();

  useEffect(() => {
    if (window.matchMedia("(orientation: portrait)").matches) {
      setIsPortrait(true);
    } else {
      setIsPortrait(false);
    }
  });

  return (
    <div className="container">
      <Sidebar
        isCollapsed={isCollapsed}
        setIsCollapsed={setIsCollapsed}
        isPortrait={isPortrait}
        setIsPortrait={setIsPortrait}
      />
      <div
        className={`main ${isCollapsed ? "collapsed" : ""} ${
          isPortrait ? "portrait" : ""
        }`}
      >
        <Navbar isCollapsed={isCollapsed} isPortrait={isPortrait} />

        <div className="body">
          <h1>CH Admin</h1>
          <Button
            multiple={true}
            color="primary"
            onClick={() => setShowModal(true)}
          >
            <div>1</div>
            <div>2</div>
            <div>3</div>
          </Button>
          <Button onClick={() => showAlert("error", "ERROR")} color="danger">
            ERROR ALERT
          </Button>
          <Button
            onClick={() => showAlert("warning", "WARNING")}
            color="warning"
          >
            WARNING ALERT
          </Button>
          <Button
            onClick={() => showAlert("success", "SUCCESS")}
            color="success"
          >
            SUCCESS ALERT
          </Button>
          <p>
            Sidebar isCollapsed:{isCollapsed && "ya"} isPortrait:
            {isPortrait && "ya"}
          </p>
          <ThemeSwitch
            className={`theme ${isCollapsed && "theme-collapsed"}`}
          />
          <Login />
        </div>
      </div>
      <Modal isOpen={showModal} onClose={() => setShowModal(false)}>
        <div>
          <h2>Children</h2>
        </div>
      </Modal>
    </div>
  );
}

export default CHLayout;
