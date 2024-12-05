import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { TooltipProvider, useTooltip } from "./Tooltip";
import "@testing-library/jest-dom";


/**
 * TooltipProvider Test Suite
 *
 * Purpose:
 * - This suite tests the functionality of the `TooltipProvider` and `useTooltip` hook, ensuring that tooltips display on hover and hide on mouse leave.
 *
 * Mock Component:
 * - `MockTooltipComponent`: A mock component that uses `useTooltip` to display a tooltip on hover.
 *   - Contains a button that:
 *     - Shows a tooltip with a specified message on mouse enter.
 *     - Hides the tooltip on mouse leave.
 *   - Displays the tooltip content if the tooltip is visible.
 *
 * Tests:
 * - `displays tooltip when hovered and hides when mouse leaves`: Verifies that:
 *   - Hovering over the button displays the tooltip message.
 *   - Moving the mouse away from the button hides the tooltip message.
 */


// Mock component to test useTooltip
const MockTooltipComponent = () => {
  const { showTooltip, hideTooltip, tooltip } = useTooltip();

  return (
    <div>
      <button
        onMouseEnter={() => showTooltip("Test Tooltip Message")}
        onMouseLeave={() => hideTooltip()}
      >
        Hover me
      </button>
      {tooltip.visible && <div>{tooltip.content}</div>}
    </div>
  );
};

describe("TooltipProvider", () => {
  test("displays tooltip when hovered and hides when mouse leaves", () => {
    render(
      <TooltipProvider>
        <MockTooltipComponent />
      </TooltipProvider>
    );

    // Hover over the button to show the tooltip
    fireEvent.mouseEnter(screen.getByText("Hover me"));

    // Check if the tooltip is displayed
    expect(screen.getByText("Test Tooltip Message")).toBeInTheDocument();

    // Stop hovering to hide the tooltip
    fireEvent.mouseLeave(screen.getByText("Hover me"));

    // Check if the tooltip is hidden
    expect(screen.queryByText("Test Tooltip Message")).not.toBeInTheDocument();
  });
});
