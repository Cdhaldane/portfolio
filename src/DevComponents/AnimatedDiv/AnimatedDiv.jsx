import React, { useState, useEffect, useId } from "react";
import { useDidMountEffect } from "../../Utils";
import "./AnimatedDiv.css";

/**
 * AnimatedDiv Component
 *
 * Purpose:
 * - A wrapper `div` component that supports customizable CSS animations for entry and exit transitions.
 * - The animation changes dynamically based on the `enterAnimation` and `exitAnimation` props.
 *
 * Notes:
 * - Ensure `useDidMountEffect` is correctly implemented to trigger effects only after the initial render.
 * - Define animations in the `AnimatedDiv.css` file to match the `enterAnimation` and `exitAnimation` prop values.
 */

const AnimatedDiv = ({
  id,
  className = "",
  enterAnimation,
  exitAnimation,
  trigger,
  children,
  ...rest
}) => {
  const [displayState, setDisplayState] = useState("none");
  const [animationClass, setAnimationClass] = useState(enterAnimation || "");

  useEffect(() => {
    if (enterAnimation) {
      setAnimationClass(enterAnimation);
    }
  }, [enterAnimation]);

  useEffect(() => {
    if (!trigger && exitAnimation) {
      setAnimationClass(exitAnimation);
    } else if (trigger && enterAnimation) {
      setAnimationClass(enterAnimation);
      setDisplayState("block");
    }
  }, [rest, trigger, enterAnimation, exitAnimation]);

  return (
    <div
      id={id || ""}
      className={`animated-div ${className}`}
      style={{
        ...(rest.style && rest.style),
        animationName: animationClass,
        animationDuration: "0.2s",
        display: displayState,
      }}
    >
      {children}
    </div>
  );
};

export default AnimatedDiv;
