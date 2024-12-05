import React, { useState } from "react";
import "./RadioGroup.css";

/**
 * RadioGroup Component
 *
 * Purpose:
 * - Provides a group of customizable buttons that behave like radio inputs.
 * - Supports multi-selection by default.
 *
 * Props:
 * - `options`: Array of objects with `label` and `value` for each button.
 * - `selectedValues`: Initial selected values as an array.
 * - `onChange`: Callback function triggered when the selection changes.
 * - `multiSelect`: Boolean indicating if multiple selections are allowed.
 *
 * Example Usage:
 * <RadioGroup
 *   options={[
 *     { label: "HTML", value: "html" },
 *     { label: "React", value: "react" },
 *     { label: "Vue", value: "vue" },
 *   ]}
 *   selectedValues={["html"]}
 *   onChange={(selected) => console.log(selected)}
 *   multiSelect={true}
 * />
 */
const RadioGroup = ({
  options = [],
  selectedValues = [],
  onChange,
  multiSelect = true,
}) => {
  const [selected, setSelected] = useState(selectedValues);

  const handleClick = (value) => {
    let newSelected;
    if (multiSelect) {
      if (selected.includes(value)) {
        newSelected = selected.filter((v) => v !== value);
      } else {
        newSelected = [...selected, value];
      }
    } else {
      newSelected = selected.includes(value) ? [] : [value];
    }

    setSelected(newSelected);
    if (onChange) onChange(newSelected);
  };

  return (
    <div className="radio-inputs">
      {options.map(({ label, value }) => (
        <label key={value} className="radio">
          <input
            type="checkbox"
            checked={selected.includes(value)}
            onChange={() => handleClick(value)}
          />
          <span
            className={`name ${selected.includes(value) ? "selected" : ""}`}
          >
            {label}
          </span>
        </label>
      ))}
    </div>
  );
};

export default RadioGroup;
