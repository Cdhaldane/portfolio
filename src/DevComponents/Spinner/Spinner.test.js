import React from "react";
import {
  render,
  screen,
  queryByAttribute,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import Spinner from "./Spinner";

const getById = queryByAttribute.bind(null, "id");

describe("Spinner Component", () => {
  test("renders Spinner component", async () => {
    const dom = render(<Spinner />);
    const spinnerElement = getById(dom.container, "spinner");

    expect(spinnerElement).toBeInTheDocument();
  });

  test("has correct class name", async () => {
    const dom = render(<Spinner />);
    const spinnerElement = getById(dom.container, "spinner");

    await waitFor(() => {
      expect(spinnerElement).toHaveClass("spinner-container");
    });
  });
});
