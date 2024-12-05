// TimePicker.test.js
import React from "react";
import { render, fireEvent, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import TimePicker from "./TimePicker";


/**
 * TimePicker Component Test Suite
 *
 * Purpose:
 * - This suite tests the functionality and behavior of the `TimePicker` component, ensuring it correctly renders default values, calls `onChange` when the time is adjusted, and handles empty values and labels.
 *
 * Tests:
 * - `renders time picker with default values`: Verifies that the component displays the specified default time values for hours, minutes, and seconds.
 * - `calls onChange when the time is changed`: Simulates selecting new values for hours, minutes, and seconds, and checks that `onChange` is called with the correct time format.
 * - `displays '00' for empty values`: Ensures that the component displays '00' for hours, minutes, and seconds when no default value is provided.
 * - `labels the div label when provided`: Confirms that the component applies the provided `label` to the container element, making it accessible.
 *
 */



describe("TimePicker Component", () => {
  test("renders time picker with default values", () => {
    render(<TimePicker defaultValue="12:30:45" />);

    const hourElement = screen.getByText("12");
    const minuteElement = screen.getByText("30");
    const secondElement = screen.getByText("45");

    expect(hourElement).toBeInTheDocument();
    expect(minuteElement).toBeInTheDocument();
    expect(secondElement).toBeInTheDocument();
  });

  test("calls onChange when the time is changed", () => {
    const handleChange = jest.fn();
    render(<TimePicker onChange={handleChange} />);

    // Select hour
    fireEvent.click(screen.getByLabelText("Hour Dropdown")); // Click to open hour dropdown
    fireEvent.click(screen.getByText("10")); // Select hour 10

    // Select minute
    fireEvent.click(screen.getByLabelText("Minute Dropdown")); // Click to open minute dropdown
    fireEvent.click(screen.getByText("25")); // Select minute 25

    // Select second
    fireEvent.click(screen.getByLabelText("Second Dropdown")); // Click to open second dropdown
    fireEvent.click(screen.getAllByText("35")[1]); // Select second 35

    expect(handleChange).toHaveBeenCalledWith("10:25:35");
  });

  test("displays '00' for empty values", () => {
    render(<TimePicker />);

    const hourElement = screen.getAllByText("00")[0];
    const minuteElement = screen.getAllByText("00")[1];
    const secondElement = screen.getAllByText("00")[2];

    expect(hourElement).toBeInTheDocument();
    expect(minuteElement).toBeInTheDocument();
    expect(secondElement).toBeInTheDocument();
  });

  test("labels the div label when provided", () => {
    render(<TimePicker label="Pick a time" />);

    const containerElement = screen.getByLabelText("Pick a time");

    expect(containerElement).toBeInTheDocument();
  });
});
