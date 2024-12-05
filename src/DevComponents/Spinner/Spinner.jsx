import React from "react";
import "./Spinner.css"; // Make sure to create this CSS file in the same directory

/**
 * Spinner Component
 *
 * Purpose:
 * - The Spinner component provides a visual indicator for loading or processing states in the application.
 * - It displays an hourglass icon that animates to signify that an action is in progress.
 *
 * Inputs:
 * - None
 *
 * Outputs:
 * - JSX for rendering the spinner animation within a container.
 */

const Spinner = () => {
  return (
    <div className="spinner-container" id="spinner">
      <div className="hourglass fast"></div>
    </div>
  );
};

export default Spinner;
