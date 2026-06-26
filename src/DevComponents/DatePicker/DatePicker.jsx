import React, { useEffect, useState } from "react";
import Modal from "../Modal/Modal";
import Input from "../Input/Input"; // Importing the Input component
import AnimatedDiv from "../AnimatedDiv/AnimatedDiv";
import "./DatePicker.css"; // Importing the CSS file for styling

/**
 * DatePicker Component
 *
 * Purpose:
 * - The DatePicker component provides a user interface for selecting a date.
 * - It consists of dropdowns for selecting day, month, and year.
 * - The component supports default values and triggers a callback function when the date is changed.
 *
 * Inputs:
 * - label: The label for the date picker (optional).
 * - onChange: A callback function that is called when the date is changed.
 * - defaultValue: The default date value in the format "YYYY-MM-DD" (optional).
 *
 * Outputs:
 * - JSX for rendering the date picker with dropdowns for day, month, and year.
 * - The selected date is passed to the onChange callback function in the format "YYYY-MM-DD".
 */

const DatePicker = ({ label, onChange = () => {}, defaultValue }) => {
  const [isOpen, setIsOpen] = useState(false); // Controls whether the calendar is open
  const [view, setView] = useState("day"); // Tracks the current view: 'year', 'month', or 'day'
  const [selectedDate, setSelectedDate] = useState(
    defaultValue ? new Date(defaultValue) : new Date()
  );
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());
  const [enterAnimation, setEnterAnimation] = useState("slideInLeft");
  const [exitAnimation] = useState("slideOutRight");

  // Open the calendar
  const openCalendar = () => {
    setIsOpen(true);
  };

  // Close the calendar
  const closeCalendar = () => {
    setIsOpen(false);
  };

  // Handle year selection
  const handleYearSelect = (year) => {
    setCurrentYear(year);
    setView("month"); // Move to month selection
  };

  // Handle month selection
  const handleMonthSelect = (month) => {
    setCurrentMonth(month);
    setView("day"); // Move to day selection
  };

  // Handle day selection
  const handleDaySelect = (day) => {
    const newDate = new Date(currentYear, currentMonth, day);
    setSelectedDate(newDate);
    onChange(newDate.toISOString().split("T")[0]); // Trigger onChange with "YYYY-MM-DD" format
    closeCalendar(); // Close the calendar after selecting a day
  };

  // Generate years for the year selection view
  const generateYears = () => {
    const years = [];
    const currentYear = new Date().getFullYear();
    for (let i = currentYear - 20; i <= currentYear + 20; i++) {
      years.push(i);
    }
    return years;
  };

  // Generate months for the month selection view
  const generateMonths = () => {
    return Array.from({ length: 12 }, (_, i) => ({
      name: new Date(0, i).toLocaleString("default", { month: "long" }),
      value: i,
    }));
  };

  // Generate days for the day selection view (calendar grid)
  const generateDays = () => {
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const firstDayOfMonth = new Date(currentYear, currentMonth, 1).getDay();
    const days = [];

    // Fill in empty slots for days before the first day of the month
    for (let i = 0; i < firstDayOfMonth; i++) {
      days.push(null);
    }

    // Fill in the days of the month
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(i);
    }

    return days;
  };

  useEffect(() => {
    if (view === "year") {
      setEnterAnimation("slideInLeft ");
    } else if (view === "month") {
      setEnterAnimation("slideInRight");
    } else {
      setEnterAnimation("slideInLeft");
    }
  }, [view]);

  return (
    <div className="date-picker-container">
      <button className="date-picker-button" onClick={openCalendar}>
        {selectedDate.toLocaleDateString()}
      </button>

      <Modal isOpen={isOpen} onClose={closeCalendar} title={label || "Date"}>
        <div className="calendar-modal">
          <div className="calendar-header">
            <button onClick={() => setView("year")} disabled={view === "year"}>
              {currentYear}
            </button>
            <button
              onClick={() => setView("month")}
              disabled={view === "month"}
            >
              {new Date(0, currentMonth).toLocaleString("default", {
                month: "long",
              })}
            </button>
          </div>

          <AnimatedDiv
            className="calendar-body"
            enterAnimation={enterAnimation}
            exitAnimation={exitAnimation}
            trigger={view}
          >
            {view === "year" && (
              <>
                <Input
                  type="text"
                  placeholder="Search"
                  label="Year"
                  className={"year-search"}
                  onInputChange={(value) => setCurrentYear(value)}
                />

                <div className="year-view">
                  {generateYears().map((year) => (
                    <button
                      key={year}
                      className={`year-item ${
                        year === currentYear ? "selected" : ""
                      }`}
                      onClick={() => handleYearSelect(year)}
                    >
                      {year}
                    </button>
                  ))}
                </div>
              </>
            )}

            {view === "month" && (
              <div className="month-view">
                {generateMonths().map((month) => (
                  <button
                    key={month.value}
                    className={`month-item ${
                      month.value === currentMonth ? "selected" : ""
                    }`}
                    onClick={() => handleMonthSelect(month.value)}
                  >
                    {month.name}
                  </button>
                ))}
              </div>
            )}

            {view === "day" && (
              <div className="day-view">
                <div className="weekdays">
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                    (day) => (
                      <div key={day} className="weekday">
                        {day}
                      </div>
                    )
                  )}
                </div>
                <div className="days-grid">
                  {generateDays().map((day, index) => (
                    <button
                      key={index}
                      className={`day-item ${
                        day === selectedDate.getDate() ? "selected" : ""
                      }`}
                      onClick={() => handleDaySelect(day)}
                      disabled={!day}
                    >
                      {day}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </AnimatedDiv>
        </div>
      </Modal>
    </div>
  );
};

export default DatePicker;
