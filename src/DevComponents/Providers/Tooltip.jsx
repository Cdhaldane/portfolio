import React, {
  createContext,
  useContext,
  useState,
  cloneElement,
} from "react";

import styled from "styled-components";

import "./Provider.css";

/**
 * TooltipContext
 *
 * Purpose:
 * - The TooltipContext is a React context that provides a way to display tooltip messages across the application.
 *
 * Outputs:
 * - A context object that can be used with useContext to access the tooltip state and functions for showing and hiding tooltips.
 */
const TooltipContext = createContext();

/**
 * useTooltip Hook
 *
 * Purpose:
 * - A custom hook that provides a convenient way to access the tooltip context.
 *
 * Outputs:
 * - The tooltip context value, which includes the current tooltip state and functions for showing and hiding tooltips.
 */

export const useTooltip = () => {
  return useContext(TooltipContext);
};

/**
 * TooltipProvider Component
 *
 * Purpose:
 * - The TooltipProvider component wraps the application with the TooltipContext.Provider to provide tooltip functionality to the entire app.
 *
 * Inputs:
 * - children: The child components of the TooltipProvider.
 *
 * Outputs:
 * - JSX for rendering the context provider with the tooltip state and functions for showing and hiding tooltips.
 */

export const TooltipProvider = ({ children }) => {
  const [tooltip, setTooltip] = useState({ visible: false, content: "" });

  // Function to hide the tooltip
  const hideTooltip = () => setTooltip({ visible: false, content: "" });
  const showTooltip = (content) => setTooltip({ visible: true, content });

  return (
    <TooltipContext.Provider value={{ tooltip, showTooltip, hideTooltip }}>
      {children}
    </TooltipContext.Provider>
  );
};

/**
 * ToolTip Component
 * 
 * Purpose:
 * - The ToolTip component provides a tooltip that appears when the user hovers over its child component.
 * - It uses the useTooltip hook to access and control the tooltip state.
 * 
 * Inputs:
 * - children: The child component over which the tooltip will appear.
 * - tooltipText: The text to be displayed in the tooltip.
 * - theme: An object containing theming properties for the tooltip.
 * 
 * Outputs:
 * - JSX for rendering the child component with a tooltip that appears on hover.
 * 
 * Example usage:
 * <Tooltip
    tooltipText="Delete Service"
    theme={{ color: "secondary" }}
  >
 */
const Tooltip = ({ tooltipText, children, theme, direction }) => {
  const [isVisible, setIsVisible] = useState(false);
  const { className, onClick } = children.props;

  const showTooltip = () => setIsVisible(true);
  const hideTooltip = () => setIsVisible(false);

  let colorVar = theme.color;

  if (!colorVar?.includes("#")) {
    colorVar = `var(--${colorVar})`;
  }

  const TooltipDiv = styled.div`
      /* Base styles for the tooltip */
      display: inline-block;
      position: relative;
      border: 3px solid ${colorVar};
      box-shadow: 2px 2px 6px ${colorVar});
      color: ${colorVar};
  
      /* Styles for the :before pseudo-element */
      &::after {
        border-top: solid ${colorVar} 10px !important;
        border-bottom: ${
          direction === "down" ? "solid" + colorVar + " 10px" : "none"
        }; 
      }
  
  
    `;

  return (
    <div
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      className={"tooltip-container " + className}
      onClick={onClick}
    >
      {children}
      {isVisible && (
        <TooltipDiv className={"tooltip " + direction}>
          {tooltipText}
        </TooltipDiv>
      )}
    </div>
  );
};

export default Tooltip;
