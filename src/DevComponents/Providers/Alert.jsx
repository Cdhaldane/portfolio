import React, { createContext, useContext, useState } from "react";

import "./Provider.css";

/**
 * AlertContext
 *
 * Purpose:
 * - The AlertContext is a React context that provides a way to display alert messages across the application.
 *
 * Outputs:
 * - A context object that can be used with useContext to access the alert state and showAlert function.
 */
const AlertContext = createContext();

/**
 * useAlert Hook
 *
 * Purpose:
 * - A custom hook that provides a convenient way to access the alert context.
 *
 * Outputs:
 * - The alert context value, which includes the current alert state and the showAlert function.
 */

export const useAlert = () => {
  return useContext(AlertContext);
};

/**
 * AlertProvider Component
 *
 * Purpose:
 * - The AlertProvider component wraps the application with the AlertContext.Provider to provide the alert functionality to the entire app.
 *
 * Inputs:
 * - children: The child components of the AlertProvider.
 *
 * Outputs:
 * - JSX for rendering the context provider with the alert state and showAlert function.
 */
export const AlertProvider = ({ children }) => {
  const [alert, setAlert] = useState(null);

  // Function to show the alert
  const showAlert = (type, message, onClick) => {
    setAlert({ type, message, onClick });
    setTimeout(() => {
      setAlert(null); // Hide the alert after 5 seconds
    }, 5000);
  };

  return (
    <AlertContext.Provider value={{ alert, showAlert }}>
      {children}
    </AlertContext.Provider>
  );
};

/**
 * Alert Component
 *
 * Purpose:
 * - The Alert component displays the current alert message with appropriate styling based on the alert type.
 *
 * Inputs:
 * - None directly; the component uses the AlertContext to access the current alert state.
 *
 * Outputs:
 * - JSX for rendering the alert message if it exists, or null if there is no alert.
 */
const Alert = () => {
  const { alert } = useContext(AlertContext);

  if (!alert) return null;

  let alertClass = "";
  switch (alert.type) {
    case "success":
      alertClass = "alert-success";
      break;
    case "warning":
      alertClass = "alert-warning";
      break;
    case "error":
      alertClass = "alert-error";
      break;
    case "info":
      alertClass = "alert-info";
      break;
    default:
      alertClass = "alert";
  }

  return (
    <div
      className={`alert ${alertClass} ${alert.onClick ? "clickable" : ""}`}
      onClick={() => alert.onClick && alert.onClick()}
    >
      <i className="fas fa-exclamation-circle"></i>

      <div className="alert-body">
        {Array.isArray(alert.message) ? (
          alert.message.map((message, index) => <p key={index}>{message}</p>)
        ) : (
          <p>{alert.message}</p>
        )}
      </div>
      {/* {alert.onClick ? <div className="click-me">Click Me!</div> : null} */}
    </div>
  );
};

export default Alert;
