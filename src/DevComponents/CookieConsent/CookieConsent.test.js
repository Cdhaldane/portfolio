import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import CookieConsent from "./CookieConsent";

describe("CookieConsent Component", () => {
  beforeEach(() => {
    localStorage.cookieConsent = "";
  });

  test("renders CookieConsent component", () => {
    render(<CookieConsent />);
    const consentText = screen.getByText(
      /We use cookies to enhance your browsing experience./i
    );
    expect(consentText).toBeInTheDocument();
  });

  test("accepts cookies when accept button is clicked", () => {
    render(<CookieConsent />);
    const acceptButton = screen.getByText(/Accept/i);
    fireEvent.click(acceptButton);
    expect(
      screen.queryByText(/We use cookies to enhance your browsing experience./i)
    ).not.toBeInTheDocument();
  });
});
