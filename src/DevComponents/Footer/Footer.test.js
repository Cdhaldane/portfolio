import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import Footer from "./Footer";

describe("Footer Component", () => {
  test("renders the footer component", () => {
    render(<Footer />);
    const footerElement = screen.getByTestId("footer");
    expect(footerElement).toBeInTheDocument();
  });

  test("renders the correct text", () => {
    render(<Footer />);
    const textElement = screen.getByText(
      /© 2024 Timeslot. All rights reserved./i
    );
    expect(textElement).toBeInTheDocument();
  });

  test("renders the correct number of links", () => {
    render(<Footer />);
    const linkElements = screen.getAllByRole("link");
    expect(linkElements.length).toBe(16); // Adjust the number based on your footer links
  });
});
