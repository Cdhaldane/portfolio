import React, { useState, useEffect } from "react";
import { darkenColor, extractHexColor } from "../Utils";
import { useDidMountEffect } from "../../Utils";
import "./Button.css";

/**
 * Button Component
 *
 * Purpose:
 * - The Button component provides a reusable button element with customizable styles and animations.
 * - It supports different colors, animations for enter and exit, and can be used individually or as part of a button group.
 *
 * Inputs:
 * - onClick: A callback function that is called when the button is clicked.
 * - children: The content to be displayed inside the button.
 * - className: Additional CSS classes to be applied to the button.
 * - type: The type attribute of the button (e.g., "button", "submit").
 * - color: The color of the button, which corresponds to a CSS variable.
 * - multiple: A boolean indicating whether the button is part of a group of buttons.
 * - enterAnimation: The CSS class for the enter animation.
 * - exitAnimation: The CSS class for the exit animation.
 * - exitTrigger: A dependency that triggers the exit animation when changed.
 * - ...props: Additional props to be passed to the button element.
 *
 * Outputs:
 * - JSX for rendering a single button or a group of buttons with the specified styles and animations.
 */

const Button = ({
  onClick,
  children,
  className = "button-default",
  type = "button",
  color = "primary",
  multiple,
  flex_dir = "column",
  enterAnimation,
  exitAnimation,
  exitTrigger,
  ...props
}) => {
  const [animationClass, setAnimationClass] = useState(enterAnimation || "");
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    if (enterAnimation) {
      setAnimationClass(enterAnimation);
    }
  }, [enterAnimation]);

  useDidMountEffect(() => {
    if (exitAnimation) {
      setAnimationClass(exitAnimation);
    }
  }, [exitTrigger]);

  const computedStyle = {
    backgroundColor: color.startsWith("#") ? color : `var(--${color})`,
  };

  const hoverStyle = {
    backgroundColor: color.startsWith("#")
      ? darkenColor(color, 20)
      : darkenColor(extractHexColor(`--${color}`), 10),
  };

  const handleMouseEnter = () => setIsHovered(true);
  const handleMouseLeave = () => setIsHovered(false);

  if (multiple && children && children.length > 1) {
    return (
      <div
        className="button-group"
        style={{
          flexDirection: flex_dir,
        }}
        role="group"
      >
        {React.Children.map(children, (child, index) => {
          return (
            <button
              type={type}
              className={`button ${className} ${animationClass}`}
              onClick={onClick}
              style={
                isHovered ? { ...computedStyle, ...hoverStyle } : computedStyle
              }
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
              {...props}
            >
              {child}
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <button
      type={type}
      className={`button ${className} ${animationClass}`}
      onClick={onClick}
      style={isHovered ? { ...computedStyle, ...hoverStyle } : computedStyle}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      {...props}
    >
      {children}
    </button>
  );
};

export default Button;
