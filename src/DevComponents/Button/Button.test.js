// Button.test.js

/**
 * Button Component Test Suite
 *
 * Purpose:
 * - This suite verifies the rendering, styling, interactivity, and animations of the `Button` component.
 * - Ensures that the button renders correctly with different props, calls callback functions on click, and handles animations as expected.
 *
 * Input:
 * - `children`: The text or elements to display inside the button.
 * - `onClick`: Callback function triggered when the button is clicked.
 * - `color`: Optional color prop for changing the button’s background color (e.g., `primary`, `secondary`).
 * - `multiple`: Optional boolean indicating if the button renders as a group of buttons.
 * - `enterAnimation`, `exitAnimation`: Animation classes applied when the button appears or disappears.
 * - `exitTrigger`: Boolean indicating if the exit animation should be triggered.
 *
 * Output:
 * - Renders the button component based on the provided props and checks for correct styles, interactions, and animations.
 *
 */




import React from "react";
import { render, fireEvent, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import Button from "./Button";

describe("Button Component", () => {
  test("renders the button with default properties", () => {
    render(<Button>Click Me</Button>);

    const buttonElement = screen.getByRole("button", { name: /click me/i });

    expect(buttonElement).toBeInTheDocument();
    expect(buttonElement).toHaveClass("button button-default");
    expect(buttonElement).toHaveStyle("backgroundColor: 'var(--primary)'");
  });

  test("calls onClick callback when button is clicked", () => {
    const handleClick = jest.fn();
    render(<Button onClick={handleClick}>Click Me</Button>);

    const buttonElement = screen.getByRole("button", { name: /click me/i });
    fireEvent.click(buttonElement);

    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  test("applies the correct color prop", () => {
    render(<Button color="secondary">Click Me</Button>);

    const buttonElement = screen.getByRole("button", { name: /click me/i });

    expect(buttonElement).toHaveStyle("backgroundColor: 'var(--secondary)'");
  });

  test("renders with multiple buttons when 'multiple' prop is true", () => {
    render(
      <Button multiple>
        <span>Button 1</span>
        <span>Button 2</span>
      </Button>
    );

    const buttonGroup = screen.getByRole("group");
    expect(buttonGroup).toHaveClass("button-group");

    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBe(2);
    expect(buttons[0]).toHaveTextContent("Button 1");
    expect(buttons[1]).toHaveTextContent("Button 2");
  });

  test("applies enter and exit animations correctly", () => {
    const { rerender } = render(
      <Button enterAnimation="fade-in">Click Me</Button>
    );

    const buttonElement = screen.getByRole("button", { name: /click me/i });
    expect(buttonElement).toHaveClass("fade-in");

    rerender(
      <Button exitAnimation="fade-out" exitTrigger={true}>
        Click Me
      </Button>
    );

    expect(buttonElement).toHaveClass("fade-out");
  });
});
