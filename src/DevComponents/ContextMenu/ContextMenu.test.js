// ContextMenu.test.js

/**
 * ContextMenu Component Test Suite
 *
 * Purpose:
 * - This test suite verifies the behavior of the `ContextMenu` component, including its visibility, positioning, option rendering, and event handling.
 *
 * Tests:
 * - `renders and positions the context menu based on props`: Confirms that the context menu is displayed at the specified coordinates (`x`, `y`) when `visible` is true.
 * - `hides the context menu when visible is false`: Ensures that the context menu is hidden when the `visible` prop is set to false.
 * - `renders all provided options`: Checks that all menu options passed in the `options` prop are rendered correctly within the menu.
 * - `calls onClick when an option is clicked`: Simulates clicking an option and verifies that the corresponding `onClick` handler is called.
 * - `calls onRequestClose when menu is clicked`: Tests if clicking on the context menu container triggers the `onRequestClose` function, allowing the menu to close.
 *
 * Helper Functions:
 * - `getById`: Uses `queryByAttribute` to locate the context menu element by its `id`.
 *
 * Mocking:
 * - Uses `jest.fn()` to create mock functions for `onClick` handlers and `onRequestClose` to validate their invocation during interactions.
 *
 * Usage:
 * - Run this suite to confirm that the `ContextMenu` component behaves as expected across various interaction scenarios and prop configurations.
 */




import React from "react";
import {
  render,
  screen,
  fireEvent,
  queryByAttribute,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import ContextMenu from "./ContextMenu";

const getById = queryByAttribute.bind(null, "id");

describe("ContextMenu Component", () => {
  const mockOptions = [
    { label: "Option 1", onClick: jest.fn() },
    { label: "Option 2", onClick: jest.fn() },
  ];

  test("renders and positions the context menu based on props", () => {
    const dom = render(
      <ContextMenu
        visible={true}
        x={100}
        y={200}
        options={mockOptions}
        onRequestClose={jest.fn()}
      />
    );

    const contextMenu = getById(dom.container, "context-menu");
    expect(contextMenu).toBeInTheDocument();
    expect(contextMenu).toHaveStyle({
      left: "100px",
      top: "200px",
      display: "block",
      animationName: "contextGrow",
    });
  });

  test("hides the context menu when visible is false", () => {
    const dom = render(
      <ContextMenu
        visible={false}
        x={100}
        y={200}
        options={mockOptions}
        onRequestClose={jest.fn()}
      />
    );

    const contextMenu = getById(dom.container, "context-menu");
    expect(contextMenu).toHaveStyle({ display: "none" });
  });

  test("renders all provided options", () => {
    render(
      <ContextMenu
        visible={true}
        x={100}
        y={200}
        options={mockOptions}
        onRequestClose={jest.fn()}
      />
    );

    const option1 = screen.getByText("Option 1");
    const option2 = screen.getByText("Option 2");

    expect(option1).toBeInTheDocument();
    expect(option2).toBeInTheDocument();
  });

  test("calls onClick when an option is clicked", () => {
    render(
      <ContextMenu
        visible={true}
        x={100}
        y={200}
        options={mockOptions}
        onRequestClose={jest.fn()}
      />
    );

    const option1 = screen.getByText("Option 1");
    fireEvent.click(option1);
    expect(mockOptions[0].onClick).toHaveBeenCalled();
  });

  test("calls onRequestClose when menu is clicked", () => {
    const mockRequestClose = jest.fn();
    const dom = render(
      <ContextMenu
        visible={true}
        x={100}
        y={200}
        options={mockOptions}
        onRequestClose={mockRequestClose}
      />
    );

    const contextMenu = getById(dom.container, "context-menu");
    fireEvent.click(contextMenu);
    expect(mockRequestClose).toHaveBeenCalled();
  });
});
