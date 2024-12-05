// Footer.js
import React from "react";
import { useLocation } from "react-router-dom";

import "./Footer.css"; // Import the CSS file for the footer

/**
 * Footer Component
 *
 * Purpose:
 * - The Footer component displays a simple footer with a copyright notice.
 *
 * Inputs:
 * - None.
 *
 * Outputs:
 * - JSX for rendering the footer with the copyright notice.
 */

const Footer = () => {
  // const location = useLocation();
  // const isCalendar =
  //   location.pathname.includes("/admin") ||
  //   location.pathname === "/home" ||
  //   location.pathname.includes("/employee");

  return (
    <footer
      className="footer"
      data-testid="footer"
      // style={{
      //   backgroundColor: isCalendar ? "var(--bg-primary)" : "var(--bg-primary)",
      // }}
    >
      <div className="footer-links">
        {/* <div className="footer-logo">
          <Clock offset={5} color={"bg-primary"} />
          <h1 className="timeslot-title">
            TIME<span>SLOT</span>
          </h1>
        </div> */}
        <div className="footer-links-column">
          <h2>Company</h2>
          <hr />
          <a href="/about#/info">About</a>
          <a href="/contact">Contact</a>
          <a href="/careers">Careers</a>
          <a href="/press">Press</a>
        </div>
        <div className="footer-links-column">
          <h2>Help</h2>
          <hr />
          <a href="/help">Help Center</a>
          <a href="/support">Support</a>
          <a href="/faq">FAQ</a>
          <a href="/privacy">Privacy Policy</a>
        </div>
        <div className="footer-links-column">
          <h2>Services</h2>
          <hr />
          <a href="/appointments">Appointments</a>
          <a href="/services">Services</a>
          <a href="/pricing">Pricing</a>
          <a href="/book">Book Now</a>
        </div>
        <div className="footer-links-column">
          <h2>Follow Us</h2>
          <hr />
          <a href="/facebook">Facebook</a>
          <a href="/twitter">Twitter</a>
          <a href="/instagram">Instagram</a>
          <a href="/linkedin">LinkedIn</a>
        </div>
      </div>
      <div className="footer-foot">
        <p>© 2024 Timeslot. All rights reserved.</p>
      </div>
    </footer>
  );
};

export default Footer;
