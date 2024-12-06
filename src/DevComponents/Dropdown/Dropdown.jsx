import React, { useState, useRef, useEffect } from "react";
import { CSSTransition } from "react-transition-group";
import "./Dropdown.css";

/**
 * Dropdown Component
 *
 * Purpose:
 * - The Dropdown component provides a customizable dropdown menu with options.
 * - Supports multiple selection via checkboxes when `listType` is set to "checkbox".
 *
 * Inputs:
 * - label: A label for the dropdown (optional).
 * - options: An array of options to be displayed in the dropdown menu.
 * - onClick: A callback function that is called when an option is selected.
 * - children: The content to be displayed in the dropdown trigger area.
 * - direction: The direction in which the dropdown menu expands ('up' or 'down').
 * - listType: Defines the list type, supports "ul" or "checkbox".
 *
 * Outputs:
 * - JSX for rendering the dropdown component with the provided options and animation effects.
 */

const Dropdown = ({
  label = "Dropdown Button",
  options,
  onClick,
  children,
  direction = "down",
  type,
  className,
  listType = "ul",
  style,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedOptions, setSelectedOptions] = useState([]);
  const [dropdownDirection, setDropdownDirection] = useState(direction);
  const [dropdownMenuLeftOffset, setDropdownMenuLeftOffset] = useState("0px");
  const dropdownRef = useRef(null);
  const dropdownMenuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [dropdownRef]);

  useEffect(() => {
    if (isOpen && dropdownRef.current) {
      const rect = dropdownRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      if (direction === "down" && spaceBelow < 300) {
        setDropdownDirection("up");
      } else if (direction === "up" && spaceAbove < 300) {
        setDropdownDirection("down");
      } else {
        setDropdownDirection(direction); // Default direction if space is sufficient
      }
    }
  }, [isOpen, direction]);

  useEffect(() => {
    if (isOpen && dropdownMenuRef.current) {
      const rect = dropdownRef.current.getBoundingClientRect();
      const menuRect = dropdownMenuRef.current.getBoundingClientRect();
      const offset = rect.width / 2 - menuRect.width / 2;
      if (offset > 0) {
        setDropdownMenuLeftOffset(`${offset}px`);
      } else {
        setDropdownMenuLeftOffset("0px");
      }
    }
  }, [isOpen]);

  const handleCheckboxChange = (option) => {
    const updatedSelection = selectedOptions.includes(option)
      ? selectedOptions.filter((selected) => selected !== option)
      : [...selectedOptions, option];

    setSelectedOptions(updatedSelection);
    onClick(updatedSelection); // Pass all selected options to the parent
  };

  return (
    <div className="dropdown" ref={dropdownRef}>
      <div
        onClick={() => setIsOpen(!isOpen)}
        className={`dropdown-holder ${isOpen ? "open" : ""}`}
        aria-label={label}
      >
        {children}
        {type === "button" ? (
          isOpen ? (
            <i className="fa-solid fa-caret-up"></i>
          ) : (
            <i className="fa-solid fa-caret-down"></i>
          )
        ) : null}
      </div>
      <CSSTransition
        in={isOpen}
        timeout={100}
        classNames="dropdown-menu"
        unmountOnExit
      >
        <div
          className={`dropdown-menu ${dropdownDirection} ${
            className && className
          }`}
          ref={dropdownMenuRef}
          style={{
            ...style,
            maxHeight: listType === "checkbox" ? "300px" : "auto",
            left: dropdownMenuLeftOffset,
          }}
        >
          {listType === "ul"
            ? options.map((option, index) => (
                <div
                  key={index}
                  className="dropdown-item"
                  onClick={() => {
                    onClick(option.label || option);
                    setIsOpen(false);
                  }}
                >
                  {option.icon && <i className={option.icon}></i>}
                  {option.label || option}
                </div>
              ))
            : listType === "checkbox"
            ? options.map((option, index) => (
                <label
                  key={index}
                  className={`dropdown-item checkbox-item ${
                    selectedOptions.includes(option) ? "selected" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedOptions.includes(option)}
                    onChange={() => handleCheckboxChange(option)}
                  />
                  <div class="checkmark"></div>
                  {option.icon && <i className={option.icon}></i>}
                  {option.label || option}
                </label>
              ))
            : null}
        </div>
      </CSSTransition>
    </div>
  );
};

export default Dropdown;
