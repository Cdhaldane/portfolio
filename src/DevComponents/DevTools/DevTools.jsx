import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import "./DevTools.css"; // Make sure to create a corresponding CSS file for styling

/**
 * DevTools Component
 *
 * Purpose:
 * - The DevTools component provides a developer tool interface for debugging purposes.
 * - It displays the contents of localStorage and sessionStorage, and allows clearing of these storage types.
 * - The tool can be collapsed or expanded with a button click.
 *
 * Inputs:
 * - None.
 *
 * Outputs:
 * - JSX for rendering the developer tool interface.
 */

const DevTools = ({ setOrgDefault }) => {
  //state hooks for managing the collapsed state and the data from localStorage and sessionStorage
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [localStorageData, setLocalStorageData] = useState({});
  const [sessionStorageData, setSessionStorageData] = useState({});
  const navigate = useNavigate();
  const devRef = useRef();

  // Effect hook to handle clicks outside of the developer tool interface
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (devRef.current && !devRef.current.contains(e.target)) {
        setIsCollapsed(true);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Effect hook to collect and set localStorage and sessionStorage data
  useEffect(() => {
    // Collect and set localStorage data
    const localData = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key !== "debug" || key !== "WP_CRX_STORAGE_SNAPSHOT_/")
        localData[key] = localStorage.getItem(key);
    }
    setLocalStorageData(localData);

    // Collect and set sessionStorage data
    const sessionData = {};
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      sessionData[key] = sessionStorage.getItem(key);
    }
    setSessionStorageData(sessionData);
  }, []);

  // Function to clear localStorage data
  const clearStorage = (type) => {
    if (type === "local") {
      localStorage.clear();
      setLocalStorageData({});
    } else {
      sessionStorage.clear();
      setSessionStorageData({});
    }
  };
  // Function to format the data for display
  const getPretty = (data) => {
    const parseValue = (value) => {
      try {
        return JSON.parse(value);
      } catch (e) {
        return value;
      }
    };

    const parsedData = Object.entries(data).reduce((acc, [key, value]) => {
      acc[key] = typeof value === "string" ? parseValue(value) : value;
      return acc;
    }, {});

    return (
      <pre>
        {Object.entries(parsedData).map(([key, value], index) => (
          <div key={index} className="dev-tools-pretty">
            {key}:{" "}
            {typeof value === "object" && value !== null
              ? getPretty(value)
              : JSON.stringify(value)}
          </div>
        ))}
      </pre>
    );
  };

  // Render the developer tool interface
  return (
    <div
      className={`dev-tools ${isCollapsed ? "collapsed" : ""}`}
      style={{ position: "fixed", bottom: 0, left: 0, zIndex: 1000 }}
      ref={devRef}
      data-testid="dev-tools"
    >
      {isCollapsed && (
        <button onClick={() => setIsCollapsed(!isCollapsed)}>
          <i className="fa-brands fa-dev"></i>
        </button>
      )}

      {!isCollapsed && (
        <div className="dev-tools-main">
          <button
            onClick={() => {
              navigate("/home/bce8fd49-4a09-4d41-83e9-7c0a13bca6c3");
            }}
          >
            Org Home
          </button>
          <button onClick={setOrgDefault}>Set Org</button>

          <h4>
            Local Storage{" "}
            <button onClick={() => clearStorage("local")}>CLEAR</button>
          </h4>
          {/* <pre>{JSON.stringify(localStorageData, null, 2)}</pre> */}
          {getPretty(localStorageData)}
          <h4>
            Session Storage{" "}
            <button onClick={() => clearStorage("session")}>CLEAR</button>
          </h4>
          <pre>{JSON.stringify(sessionStorageData, null, 2)}</pre>
          {/* Add any other information you find useful for development */}
        </div>
      )}
    </div>
  );
};

export default DevTools;
