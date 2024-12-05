import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AlertProvider, useAlert } from "./Alert";
import { TooltipProvider, useTooltip } from "./Tooltip";
import "@testing-library/jest-dom";


/**
 * AppProviders Test Suite
 *
 * Purpose:
 * - This suite tests the combined functionality of `AlertProvider` and `TooltipProvider` in a single component to ensure both alerts and tooltips work together seamlessly.
 *
 * Mock Component:
 * - `MockCombinedComponent`: A mock component that uses both `useAlert` and `useTooltip` hooks.
 *   - Contains a button that:
 *     - Shows an alert when clicked.
 *     - Shows a tooltip on mouse enter and hides it on mouse leave.
 *   - Displays the alert message if an alert is present.
 *   - Displays the tooltip content if the tooltip is visible.
 *
 * Tests:
 * - `shows alert and tooltip in the same component`: Verifies that:
 *   - Clicking the button triggers the alert message, which displays and then disappears after the timeout.
 *   - Hovering over the button displays the tooltip message, which disappears when the hover stops.
 */



jest.setTimeout(10000); // Set timeout to 10 seconds for all tests in this file

const MockCombinedComponent = () => {
  const { showAlert, alert } = useAlert();
  const { showTooltip, hideTooltip, tooltip } = useTooltip();

  return (
    <div>
      <button
        onClick={() => showAlert("success", "Alert Message")}
        onMouseEnter={() => showTooltip("Tooltip Message")}
        onMouseLeave={() => hideTooltip()}
      >
        Test Button
      </button>

      {alert && <p>{alert.message}</p>}
      {tooltip.visible && <div>{tooltip.content}</div>}
    </div>
  );
};

describe("AppProviders", () => {
  test("shows alert and tooltip in the same component", async () => {
    render(
      <AlertProvider>
        <TooltipProvider>
          <MockCombinedComponent />
        </TooltipProvider>
      </AlertProvider>
    );

    // Trigger the alert by clicking
    fireEvent.click(screen.getByText("Test Button"));
    expect(screen.getByText("Alert Message")).toBeInTheDocument();

    // Wait for alert to disappear
    await waitFor(
      () => {
        expect(screen.queryByText("Alert Message")).not.toBeInTheDocument();
      },
      { timeout: 6000 }
    );

    // Trigger the tooltip by hovering
    fireEvent.mouseEnter(screen.getByText("Test Button"));
    expect(screen.getByText("Tooltip Message")).toBeInTheDocument();

    // Stop hovering to hide the tooltip
    fireEvent.mouseLeave(screen.getByText("Test Button"));
    expect(screen.queryByText("Tooltip Message")).not.toBeInTheDocument();
  });
});
