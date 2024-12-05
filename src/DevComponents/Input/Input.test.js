// Input.test.js

/**
 * Input Component Test Suite
 *
 * Purpose:
 * - This suite verifies the rendering, interactivity, and validation of the `Input` and `InputForm` components, ensuring they function as expected with user input, validation, and event handling.
 *
 * Tests:
 * - `renders the input with label and placeholder`: Confirms that the input field displays the correct label, placeholder, and type attributes.
 * - `calls onInputChange when the input value changes`: Checks that the `onInputChange` callback is called with the correct value when the input changes.
 * - `handles focus and blur events correctly`: Verifies that the input container gains an 'active' class on focus and removes it on blur if empty.
 * - `submits the form when Enter key is pressed`: Ensures that pressing Enter triggers the `onSubmit` callback, simulating form submission.
 * - `shows validation error for invalid input`: Tests that entering an invalid phone number shows a validation error alert.
 * - `renders the icon when provided`: Ensures the icon is displayed in the input field if the `icon` prop is set.
 *
 * InputForm Component:
 * - `renders multiple input fields and handles submission`: Checks that the `InputForm` renders multiple input fields based on `states` and correctly submits entered values through `handleSubmit`.
 *
 * Input:
 * - `label`: Label for the input.
 * - `placeholder`: Placeholder text for the input.
 * - `type`: Input type (e.g., "email", "text", "password").
 * - `value`: Initial value for the input.
 * - `onInputChange`: Callback function for handling input changes.
 * - `onSubmit`: Callback function triggered when the form is submitted (e.g., by pressing Enter).
 * - `icon`: Optional icon displayed in the input field.
 *
 *
 * Output:
 * - Renders the `Input` and `InputForm` components based on provided props and tests for correct behavior with user input, form submission, and validation feedback.
 *
 */


import React from "react";
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import Input, { InputForm } from "./Input";
import { useAlert } from "../Providers/Alert";

// Mock the useAlert hook
jest.mock("../Providers/Alert", () => ({
  useAlert: jest.fn(),
}));

describe("Input Component", () => {
  let mockShowAlert;

  beforeEach(() => {
    mockShowAlert = jest.fn();
    useAlert.mockReturnValue({
      showAlert: mockShowAlert,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test("renders the input with label and placeholder", () => {
    render(
      <Input
        label="Email"
        placeholder="Enter your email"
        type="email"
        value=""
        onInputChange={() => {}}
      />
    );

    const inputElement = screen.getByRole("textbox");
    const labelElement = screen.getByText("Email");

    expect(inputElement);
    expect(labelElement);
    expect(inputElement).toHaveAttribute("type", "email");
  });

  test("calls onInputChange when the input value changes", () => {
    const handleChange = jest.fn();
    render(
      <Input
        label="Name"
        placeholder="Enter your name"
        type="text"
        value=""
        onInputChange={handleChange}
      />
    );

    const inputElement = screen.getByRole("textbox");
    fireEvent.change(inputElement, { target: { value: "John Doe" } });

    expect(handleChange).toHaveBeenCalledWith("John Doe");
  });

  test("handles focus and blur events correctly", async () => {
    const user = userEvent.setup();
    render(
      <Input
        label="Password"
        placeholder="Enter your password"
        type="password"
        value=""
        onInputChange={() => {}}
      />
    );

    const inputContainer = screen.getByTestId("input-container");
    const inputElement = screen.getByLabelText("Password");

    // Initially, the input should not have 'active' class
    expect(inputContainer).not.toHaveClass("active");

    // Focus on the input
    user.click(inputElement);
    await waitFor(() => {
      expect(inputContainer).toHaveClass("active");
    });

    // Blur the input without any value
    user.click(document.body); // move the focus away
    await waitFor(() => {
      expect(inputContainer).not.toHaveClass("active");
    });

    // Input a value and blur
    user.click(inputElement, { target: { value: "password123" } });
    await waitFor(() => {
      expect(inputContainer).toHaveClass("active");
    });
  });

  test("submits the form when Enter key is pressed", async () => {
    const handleSubmit = jest.fn();
    render(
      <Input
        label="Username"
        placeholder="Enter your username"
        type="text"
        value=""
        onInputChange={() => {}}
        onSubmit={handleSubmit}
      />
    );

    const inputElement = screen.getByLabelText("Username");

    fireEvent.change(inputElement, { target: { value: "testuser" } });
    fireEvent.keyDown(inputElement, { key: "Enter", code: "Enter" });

    // Wait for any asynchronous events
    await waitFor(() => {
      expect(handleSubmit).toHaveBeenCalled();
    });
  });

  test("shows validation error for invalid input", async () => {
    render(
      <Input
        label="Phone"
        placeholder="Enter your phone number"
        type="tel"
        value=""
        onInputChange={() => {}}
      />
    );

    const inputElement = screen.getByLabelText("Phone");

    // Input an invalid phone number
    fireEvent.change(inputElement, { target: { value: "12345" } });
    fireEvent.blur(inputElement);

    // Simulate form submission
    fireEvent.keyDown(inputElement, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(mockShowAlert).toHaveBeenCalledWith(
        "error",
        "Please enter a valid phone number (e.g., 123-456-7890)."
      );
    });
  });

  test("renders the icon when provided", async () => {
    render(
      <Input
        label="Search"
        placeholder="Search..."
        type="text"
        value=""
        onInputChange={() => {}}
        icon="fa-search"
      />
    );

    const iconElement = screen.getByRole("button");
    await waitFor(() => {
      expect(iconElement);
      expect(iconElement).toContainHTML('<i class="icon fa-search"></i>');
    });
  });
});

describe("InputForm Component", () => {
  test("renders multiple input fields and handles submission", async () => {
    const handleSubmit = jest.fn();
    const handleClose = jest.fn();

    const states = [
      { id: "email", label: "Email", type: "email" },
      { id: "password", label: "Password", type: "password" },
    ];

    render(
      <InputForm
        id="login-form"
        states={states}
        onSubmit={handleSubmit}
        onClose={handleClose}
        buttonLabel="Login"
      />
    );

    const emailInput = screen.getByLabelText("Email");
    const passwordInput = screen.getByLabelText("Password");
    const submitButton = screen.getByRole("button", { name: "Login" });

    fireEvent.change(emailInput, { target: { value: "user@example.com" } });
    fireEvent.change(passwordInput, { target: { value: "password123" } });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(handleSubmit).toHaveBeenCalledWith({
        email: "user@example.com",
        password: "password123",
      });

      expect(handleClose).toHaveBeenCalled();
    });
  });
});
