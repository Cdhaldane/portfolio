import React, { useEffect, useState, useRef } from "react";
import Input from "../Input/Input"; // Importing the Input component
import Dropdown from "../Dropdown/Dropdown";
import "./TimePicker.css"; // Importing the CSS file for styling

/**
 * TimePicker Component
 *
 * Purpose:
 * - The TimePicker component provides a user interface for selecting a time.
 * - It consists of dropdowns for selecting hours, minutes, and seconds.
 * - The component supports default values and triggers a callback function when the time is changed.
 *
 * Inputs:
 * - label: The label for the time picker (optional).
 * - onChange: A callback function that is called when the time is changed.
 * - defaultValue: The default time value in the format "HH:MM:SS" (optional).
 *
 * Outputs:
 * - JSX for rendering the time picker with dropdowns for hours, minutes, and seconds.
 * - The selected time is passed to the onChange callback function in the format "HH:MM:SS".
 */

const TimePicker = ({ label, onChange, defaultValue }) => {
  const [selectedHour, setSelectedHour] = useState("");
  const [selectedMinute, setSelectedMinute] = useState("");
  const [selectedSecond, setSelectedSecond] = useState("");
  const [timeWidth, setTimeWidth] = useState("100%"); // State variable to store the width of the time picker
  const timeRef = useRef(null);

  useEffect(() => {
    if (defaultValue) {
      const [hour, minute, second] = defaultValue.split(":");
      setSelectedHour(hour);
      setSelectedMinute(minute);
      setSelectedSecond(second);
    }
  }, []);

  const generateHourOptions = () => {
    return Array.from({ length: 24 }, (_, index) => (
      <option key={index} value={index < 10 ? `0${index}` : index}>
        {index}
      </option>
    ));
  };

  const generateMinuteAndSecondOptions = () => {
    return Array.from({ length: 60 }, (_, index) => (
      <option key={index} value={index < 10 ? `0${index}` : index}>
        {index < 10 ? `0${index}` : index}
      </option>
    ));
  };

  const triggerChange = (hour, minute, second) => {
    const h = hour?.props?.value || "00";
    const m = minute?.props?.value || "00";
    const s = second?.props?.value || "00";
    if (onChange) {
      onChange(
        `${h}:${m}:${s}` // Calling the onChange function with the selected time
      );
    }
  };

  const dropdownProps = {
    direction: "down",
    className: "time-select-dropdown",
  };

  return (
    <div
      className="time-picker-container"
      style={{
        display: "flex",
        alignItems: "center",
        width: timeWidth,
      }}
      ref={timeRef}
      aria-label={label}
    >
      <span className="time-picker-title">
        <i className="fa-solid fa-clock"></i>
      </span>
      <div className="time-picker">
        <Dropdown
          options={generateHourOptions()}
          onClick={(hour) => {
            setSelectedHour(hour);
            triggerChange(hour, selectedMinute, selectedSecond);
          }}
          label="Hour Dropdown"
          {...dropdownProps}
        >
          <span className="time-select">
            {selectedHour || (
              <div style={{ color: "var(--light-grey" }}>00</div>
            )}
          </span>
        </Dropdown>
        <span className="time-label">:</span>
        <Dropdown
          options={generateMinuteAndSecondOptions()}
          onClick={(minute) => {
            setSelectedMinute(minute);
            triggerChange(selectedHour, minute, selectedSecond);
          }}
          label="Minute Dropdown"
          {...dropdownProps}
        >
          <span className="time-select">
            {selectedMinute || (
              <div style={{ color: "var(--light-grey" }}>00</div>
            )}
          </span>
        </Dropdown>
        <span className="time-label">:</span>
        <Dropdown
          options={generateMinuteAndSecondOptions()}
          onClick={(second) => {
            setSelectedSecond(second);
            triggerChange(selectedHour, selectedMinute, second);
          }}
          label="Second Dropdown"
          {...dropdownProps}
        >
          <span className="time-select">
            {selectedSecond || (
              <div style={{ color: "var(--light-grey" }}>00</div>
            )}
          </span>
        </Dropdown>
      </div>
    </div>
  );
};

export default TimePicker;
