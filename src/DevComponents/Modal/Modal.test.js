// Modal.test.js

/**
 * Modal Component Test Suite
 *
 * Purpose:
 * - This suite verifies the functionality and behavior of the `Modal` component, ensuring it renders conditionally based on `isOpen`, and calls `onClose` under appropriate conditions.
 *
 * Tests:
 * - `renders modal when isOpen is true`: Confirms that the modal content is displayed when `isOpen` is true.
 * - `does not render modal when isOpen is false`: Ensures the modal content is not rendered when `isOpen` is false.
 * - `calls onClose when clicking outside the modal`: Simulates an outside click and verifies that `onClose` is called, closing the modal.
 * - `calls onClose when the close button is clicked`: Checks that clicking the close button inside the modal triggers `onClose`.
 *
 * Input:
 * - `isOpen`: Boolean prop that determines whether the modal is visible.
 * - `onClose`: Callback function called when the modal is closed (e.g., clicking outside or on the close button).
 * - `children`: The content to display inside the modal.
 *
 * Output:
 * - Renders the `Modal` component based on `isOpen` and verifies user interactions for closing the modal.
 *
 */



import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import Modal from "./Modal";

describe("Modal Component", () => {
  test("renders modal when isOpen is true", () => {
    render(
      <Modal isOpen={true} onClose={() => {}}>
        <div>Modal Content</div>
      </Modal>
    );

    // Check if the modal content is rendered
    const modalContent = screen.getByText(/modal content/i);
    expect(modalContent).toBeInTheDocument();
  });

  test("does not render modal when isOpen is false", () => {
    render(
      <Modal isOpen={false} onClose={() => {}}>
        <div>Modal Content</div>
      </Modal>
    );

    // Ensure modal content is not rendered
    const modalContent = screen.queryByText(/modal content/i);
    expect(modalContent).not.toBeInTheDocument();
  });

  test("calls onClose when clicking outside the modal", () => {
    const handleClose = jest.fn();

    const { container } = render(
      <Modal isOpen={true} onClose={handleClose}>
        <div>Modal Content</div>
      </Modal>
    );

    // Simulate click outside the modal
    fireEvent.mouseDown(container);

    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  test("calls onClose when the close button is clicked", () => {
    const handleClose = jest.fn();

    render(
      <Modal isOpen={true} onClose={handleClose}>
        <div>Modal Content</div>
      </Modal>
    );

    // Simulate clicking the close button
    const closeButton = screen.getByText(/×/i);
    fireEvent.click(closeButton);

    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
