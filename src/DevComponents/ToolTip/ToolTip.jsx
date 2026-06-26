import React, { useState } from "react";
import "./ToolTip.css";

const ToolTip = ({
  content,
  children,
  position = "top",
  delay = 200,
  style,
}) => {
  const [, setIsVisible] = useState(false);
  const [timeoutId, setTimeoutId] = useState(null);

  const handleMouseEnter = () => {
    // Delay showing the tooltip
    const id = setTimeout(() => setIsVisible(true), delay);
    setTimeoutId(id);
  };

  const handleMouseLeave = () => {
    // Clear the timeout if the mouse leaves before the delay
    clearTimeout(timeoutId);
    setIsVisible(false);
  };

  return (
    <div
      className="tooltip-container"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      aria-describedby="tooltip"
    >
      {children}
      <div
        className={`tooltip tooltip-${position}`}
        style={style}
        role="tooltip"
        id="tooltip"
      >
        {content}
      </div>
    </div>
  );
};

export default ToolTip;
