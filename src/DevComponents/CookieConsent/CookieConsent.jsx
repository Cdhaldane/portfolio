import React, { useState, useEffect } from "react";
import "./CookieConsent.css"; // Make sure to create a corresponding CSS file

/**
 * CookieConsent Component
 *
 * Purpose:
 * - The CookieConsent component provides a modal for obtaining user consent for the use of cookies.
 * - It displays a message informing the user about the use of cookies and provides a button to accept the consent.
 * - The consent status is stored in localStorage to prevent the modal from reappearing on subsequent visits.
 *
 * Inputs:
 * - None
 *
 * Outputs:
 * - JSX for rendering the cookie consent modal with a message and an "I Accept" button.
 * - A handler for setting the consent status in localStorage and hiding the modal when the user accepts.
 */

const CookieConsent = () => {
  const [isVisible, setIsVisible] = useState(false);
  const isLocalHost = window.location.hostname == "localhost";

  useEffect(() => {
    const consent = localStorage.getItem("cookieConsent");
    if (!consent) {
      setIsVisible(true);
    }
  }, []);

  const handleAccept = () => {
    localStorage.setItem("cookieConsent", "accepted");
    setIsVisible(false);
  };

  return (
    isVisible && (
      <div className="modal">
        <div className="cookie-consent">
          <p>
            We use cookies to enhance your browsing experience. By continuing to
            browse, you consent to our use of cookies.
          </p>
          <button onClick={handleAccept}>I Accept</button>
        </div>
      </div>
    )
  );
};

export default CookieConsent;
