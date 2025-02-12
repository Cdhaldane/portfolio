import React, { useState, useRef, useEffect, cloneElement } from "react";
import { useAlert } from "../Providers/Alert";

import "./Input.css";

/**
 * Input Component
 * 
 * Purpose:
 * - The Input component provides a reusable and customizable input field with dynamic label positioning.
 * 
 * Inputs:
 * - label: The label for the input field.
 * - placeholder: The placeholder text for the input field.
 * - value: The value of the input field (controlled by the parent component).
 * - onInputChange: A callback function that is called when the input value changes.
 * - type: The type of the input field (e.g., "text", "email", "password", "tel").
 * - className: Additional class names for styling the input container.
 * 
 * Outputs:
 * - JSX for rendering the input field with dynamic label positioning and optional styling.
 * 
 *EXAMPLE USE: 
  <Input
   label="Email"
   placeholder="Email"
   type="email"
   value={email}
   onInputChange={(newValue) => setEmail(newValue)}
 />;
 */

const Input = ({
  id,
  label,
  placeholder,
  value: propValue,
  onInputChange,
  onSubmit,
  type = "text",
  className,
  icon,
  options = [],
}) => {
  const [isActive, setIsActive] = useState(propValue ? true : false);
  const [inputValue, setInputValue] = useState(propValue || "");
  const [hasChanged, setHasChanged] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const inputRef = useRef(null);
  const alert = useAlert();

  // Update local state when propValue changes
  useEffect(() => {
    setInputValue(propValue || "");
    setIsActive(!!propValue);
  }, [propValue]);

  const formatPhoneNumber = (value) => {
    const cleaned = value.replace(/\D/g, ""); // Remove all non-digit characters
    const match = cleaned.match(/^(\d{3})(\d{3})(\d{4})$/); // Match the format 123-456-7890
    if (match) {
      return `${match[1]}-${match[2]}-${match[3]}`;
    }
    return value; // Return the value as is if it doesn't match
  };

  const validateInput = (value) => {
    if (type === "email" && !/^\S+@\S+\.\S+$/.test(value)) {
      alert.showAlert("error", "Invalid email format.");
      return false;
    }
    if (type === "tel" && !/^\d{3}-\d{3}-\d{4}$/.test(value)) {
      alert.showAlert(
        "error",
        "Phone number must be in the format 123-456-7890."
      );
      return false;
    }
    if (type === "text" && value.trim() === "") {
      alert.showAlert("error", "Text field cannot be empty.");
      return false;
    }
    return true;
  };

  const handleChange = (event) => {
    let newValue = event.target.value;

    if (type === "tel") newValue = formatPhoneNumber(newValue);
    if (type === "address") fetchAddressSuggestions(newValue);

    setInputValue(newValue);
    if (onInputChange) onInputChange(newValue);
    setHasChanged(true);
  };

  const handleFocus = () => {
    setIsActive(true);
  };

  const handleBlur = () => {
    if (!validateInput(inputValue)) {
      setInputValue("");
    }
    if (!inputValue) {
      setIsActive(false);
    }
    setTimeout(() => setSuggestions([]), 200);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    let isFormValid = true;

    // Loop through each input element in the form and check its validity
    const inputs = inputRef.current.querySelectorAll("input,textarea,select");
    inputs.forEach((input) => {
      if (!input.checkValidity()) {
        isFormValid = false;
        if (input.pattern === "[0-9]{3}-[0-9]{3}-[0-9]{4}") {
          alert.showAlert(
            "error",
            "Please enter a valid phone number (e.g., 123-456-7890)."
          );
        } else {
          alert.showAlert("error", input.validationMessage);
        }
      }
    });

    if (!isFormValid) {
      return; // Exit the function if the form is invalid
    }

    // If the form is valid, proceed with submitting the form data
    if (onSubmit) await onSubmit(e, inputValue);
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter") {
      handleSubmit(e);
    }
  };

  const fetchAddressSuggestions = async (query) => {
    if (!query) return;

    try {
      const response = await fetch(
        "https://nominatim.openstreetmap.org/search",
        {
          params: {
            q: query,
            format: "json",
            addressdetails: 1,
            limit: 5,
            countrycodes: "us,ca", // Restrict to U.S. and Canada
            extratags: 1, // Include additional tags like "shop" and "amenity" (business-related)
          },
        }
      );

      // Extract relevant details from the response to display as suggestions
      setSuggestions(
        response.data.map((result) => ({
          display_name: result.display_name,
          lat: result.lat,
          lon: result.lon,
        }))
      );
    } catch (error) {
      console.error("Error fetching address suggestions:", error);
      alert.showAlert("error", "Failed to fetch address suggestions");
    }
  };

  const handleSelectSuggestion = (suggestion) => {
    setInputValue(suggestion.display_name);
    setSuggestions([]); // Clear suggestions after selection
    if (onInputChange) {
      onInputChange(suggestion.display_name);
    }
  };

  return (
    <div
      id="input-container"
      data-testid="input-container"
      className={`input-container ${
        isActive && "active"
      } type-${type} ${className} ${hasChanged && "changed"} ${
        suggestions.length > 0 && "has-suggestions"
      }`}
      ref={inputRef}
      onSubmit={(e) => handleSubmit(e)}
      onKeyDown={(e) => handleKeyPress(e)}
    >
      {type === "textarea" && (
        <textarea
          id={id}
          value={inputValue}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          // placeholder={placeholder}
        />
      )}
      {type === "select" && (
        <select
          id={id || label}
          value={inputValue}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          required={true}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
      {type !== "textarea" && type !== "select" && (
        <input
          id={id || label}
          type={type}
          value={inputValue}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          required={true}
          pattern={type === "tel" ? "[0-9]{3}-[0-9]{3}-[0-9]{4}" : null}
          autoComplete={type}
        />
      )}
      <label htmlFor={label} aria-labelledby={label}>
        {label}
      </label>
      {icon && (
        <button
          className="input-submit-button"
          onClick={(e) => handleSubmit(e)}
        >
          <i className={`icon ${icon}`}></i>
        </button>
      )}

      {suggestions.length > 0 && (
        <ul className="input-suggestions-dropdown">
          {suggestions.map((suggestion, index) => (
            <li
              key={index}
              className="input-suggestion-item"
              onClick={() => handleSelectSuggestion(suggestion)}
            >
              {suggestion.display_name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export const InputForm = ({
  states,
  onSubmit,
  id,
  children,
  onClose = () => {},
  buttonLabel,
  successMessage,
}) => {
  // Ref for the form element
  const inputRef = useRef(null);
  const compacted = false; // Set to true to compact the form for mobile view
  const [values, setValues] = useState({});

  // Function to handle input changes
  const handleChange = (id, newValue) => {
    setValues({ ...values, [id]: newValue });
  };

  // Function to handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    await onSubmit(values);
    onClose();
  };

  // Render the input form
  return (
    <div>
      <div className="input-form-title">
        {id.toUpperCase().replace("-", " ")}
      </div>
      <div ref={inputRef} className={`input-form ${compacted && "compacted"}`}>
        {states.map((state, index) => {
          return state.child ? (
            cloneElement(state.child, {
              key: index,
              onChange: (value) => handleChange(state.id, value),
              value: values[state.id],
              id: state.id,
              className: "input-container",
            })
          ) : (
            <Input
              key={index}
              label={state.label}
              type={state.type}
              onInputChange={(value) => handleChange(state.id, value)}
            />
          );
        })}
        {children}
        <button type="submit" onClick={handleSubmit}>
          {buttonLabel}
        </button>
      </div>
    </div>
  );
};

export default Input;
