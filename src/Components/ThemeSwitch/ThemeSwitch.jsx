import React, { useState, useRef, useEffect } from "react";
import "./ThemeSwitch.css";

function ThemeSwitch(props) {
  const [isDarkMode, setIsDarkMode] = useState(true);
  const sunRef = useRef(null);
  const moonRef = useRef(null);

  useEffect(() => {
    if (isDarkMode) {
      moonRef.current?.classList.add("active");
      sunRef.current?.classList.remove("active");
      document.body.classList.remove("light-mode");
      console.log("Dark Mode");
      localStorage.setItem("isDarkMode", true);
    } else {
      moonRef.current?.classList.remove("active");
      sunRef.current?.classList.add("active");
      document.body.classList.add("light-mode");
      localStorage.setItem("isDarkMode", false);
    }
  }, [isDarkMode]);

  return (
    <div className={props.className}>
      <label className="switch">
        <i
          ref={sunRef}
          className="fa-solid fa-sun"
          onClick={() => setIsDarkMode(false)}
          aria-label="Activate Light Mode"
        ></i>
        <div
          className={`slider-theme ${
            isDarkMode ? "slider-moon" : "slider-sun"
          }`}
        ></div>
        <i
          ref={moonRef}
          className="fa-solid fa-moon"
          onClick={() => setIsDarkMode(true)}
          aria-label="Activate Dark Mode"
        ></i>
      </label>
    </div>
  );
}

export default ThemeSwitch;
