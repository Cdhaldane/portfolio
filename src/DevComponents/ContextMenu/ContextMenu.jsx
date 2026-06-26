import React, { useEffect, useState, useRef } from "react";
import ReactDOM from "react-dom";
import AnimatedDiv from "../AnimatedDiv/AnimatedDiv";
import "./ContextMenu.css";

let oldKey;

/**
 * ContextMenu Component
 *
 * Purpose:
 * This component renders a custom context menu at a given position on the screen. It's shown or hidden
 * based on the `visible` prop and positioned according to `x` and `y` coordinates. The menu animates
 * in and out based on its visibility and provides a list of options that a user can click on.
 *
 * Example Usage:
 * <ContextMenu
        visible={contextMenu.visible}
        x={contextMenu.x}
        y={contextMenu.y}
        options={[
          { label: "Copy", onClick: () => handleCopy() },
          { label: "Paste", onClick: () => handlePaste() },
          { label: "Delete", onClick: () => handleDelete() },
        ]}
        onRequestClose={handleCloseContextMenu}
      />
    </div>
 */
const ContextMenu = ({
  contextMenuProps,
  options = [
    {
      label: "Copy",
      onClick: () => console.log("copy"),
      icon: "fa-solid fa-copy",
    },
    {
      label: "Paste",
      onClick: () => console.log("paste"),
      icon: "fa-solid fa-paste",
    },
    {
      label: "Delete",
      onClick: () => console.log("delete"),
      icon: "fa-solid fa-trash",
    },
  ],
  onRequestClose,
}) => {
  const [contextMenu, setContextMenu] = useState({
    key: 0,
    visible: false,
    x: 0,
    y: 0,
  });
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const menuRef = useRef(document.createElement("div"));

  useEffect(() => {
    setContextMenu(contextMenuProps);
  }, [contextMenuProps]);

  useEffect(() => {
    const menuElement = menuRef.current;
    menuElement.style.position = "absolute";
    menuElement.style.zIndex = 1000;
    menuElement.style.left = 0;
    menuElement.style.top = 0;
    document.body.appendChild(menuElement);

    return () => {
      document.body.removeChild(menuElement);
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (!menuRef.current.contains(e.target)) {
        onRequestClose && onRequestClose();
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => {
      document.removeEventListener("click", handleClickOutside);
    };
  }, [onRequestClose]);

  useEffect(() => {
    if (contextMenu.visible && contextMenu?.key !== oldKey) {
      setContextMenu({
        ...contextMenu,
        visible: false,
      });
      setTimeout(() => {
        setContextMenu({
          ...contextMenu,
          visible: true,
        });
      }, 200);
    }
    oldKey = contextMenu?.key;
  }, [contextMenu.key]);

  useEffect(() => {
    if (contextMenu.visible) {
      const x = contextMenu.x;
      const y = contextMenu.y + window.scrollY;

      setPosition({ x, y });
    }
  }, [contextMenu.x, contextMenu.y, contextMenu.visible]);

  const radius = 40; // Radius of the circular menu
  const angleStep = (2 * Math.PI) / options.length; // Angle between each option

  const contextMenuContent = (
    <AnimatedDiv
      id={"context-menu"}
      enterAnimation={"contextGrow"}
      exitAnimation={"contextHide"}
      trigger={contextMenu?.visible}
      className="custom-context-menu"
      style={{
        left: position?.x,
        top: position?.y,
      }}
    >
      {options.map((option, index) => {
        const angle = index * angleStep;
        const optionX = radius * Math.cos(angle);
        const optionY = radius * Math.sin(angle);
        const style = contextMenu.circleMode
          ? {
              position: "absolute",
              left: optionX,
              top: optionY,
              transform: "translate(-50%, -50%)",
            }
          : {};
        return (
          <div
            key={index}
            className={`context-menu-option ${
              contextMenu.circleMode ? "circle" : ""
            }`}
            style={style}
            onClick={(e) => {
              e.stopPropagation(); // Prevent closing when clicking an option
              option.onClick();
              if (onRequestClose) {
                onRequestClose(); // Close menu after selecting an option
              }
            }}
          >
            {option.icon && contextMenu.circleMode ? (
              <i className={`icon ${option.icon}`}></i>
            ) : (
              <>
                <i className={`icon ${option.icon}`}></i>
                <span>{option.label}</span>
              </>
            )}
          </div>
        );
      })}
    </AnimatedDiv>
  );

  return ReactDOM.createPortal(contextMenuContent, menuRef.current);
};

export default ContextMenu;
