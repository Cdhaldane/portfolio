// AnimatedDiv.test.js
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import AnimatedDiv from "./AnimatedDiv";


/**
 * AnimatedDiv Component Test Suite
 *
 * Purpose:
 * - This test suite verifies the functionality of the `AnimatedDiv` component, focusing on rendering, entry and exit animations, and animation updates.
 *
 * Note:
 * - Ensure the CSS animations (e.g., `fade-in`, `fade-out`, `slide-in`, `zoom-in`) are defined in the stylesheet.
 */



describe("AnimatedDiv Component", () => {
  test("renders the children correctly", async () => {
    render(
      <AnimatedDiv className="test-class">
        <span>Test Content</span>
      </AnimatedDiv>
    );

    const contentElement = screen.getByText(/Test Content/i).parentElement;
    await waitFor(() => {
      expect(contentElement).toBeInTheDocument();
      expect(contentElement).toHaveClass("test-class");
    });
  });

  test("applies enter animation correctly", () => {
    render(
      <AnimatedDiv enterAnimation="fade-in">
        <span>Test Content</span>
      </AnimatedDiv>
    );

    const animatedDiv = screen.getByText(/Test Content/i).parentElement;
    expect(animatedDiv).toHaveStyle("animationName: fade-in");
  });

  test("applies exit animation when exitTrigger is true", async () => {
    const { rerender } = render(
      <AnimatedDiv exitAnimation="fade-out" exitTrigger={false}>
        <span>Test Content</span>
      </AnimatedDiv>
    );

    const animatedDiv = screen.getByText(/Test Content/i).parentElement;
    await waitFor(() => {
      expect(animatedDiv).not.toHaveStyle("animationName: fade-out");
    });

    // Rerender with exitTrigger set to true
    rerender(
      <AnimatedDiv exitAnimation="fade-out" exitTrigger={true}>
        <span>Test Content</span>
      </AnimatedDiv>
    );

    await waitFor(() => {
      expect(animatedDiv).toHaveStyle("animationName: fade-out");
    });
  });

  test("changes animation on enterAnimation prop update", async () => {
    const { rerender } = render(
      <AnimatedDiv enterAnimation="slide-in">
        <span>Test Content</span>
      </AnimatedDiv>
    );

    const animatedDiv = screen.getByText(/Test Content/i).parentElement;

    await waitFor(() => {
      expect(animatedDiv).toHaveStyle("animationName: slide-in");
    });

    // Rerender with a new enterAnimation prop
    rerender(
      <AnimatedDiv enterAnimation="zoom-in">
        <span>Test Content</span>
      </AnimatedDiv>
    );

    expect(animatedDiv).toHaveStyle("animationName: zoom-in");
  });
});
