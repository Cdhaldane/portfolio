import React, { useState, useEffect, useRef } from "react";
import "./Modal.css";

/**
 * Modal Component
 *
 * Purpose:
 * - The Modal component provides a reusable modal dialog box that can be opened and closed.
 * - It supports rendering any children elements passed to it, allowing for custom content within the modal.
 *
 * Inputs:
 * - isOpen: A boolean value indicating whether the modal should be open or closed.
 * - onClose: A callback function that is called when the modal needs to be closed, typically triggered by clicking outside the modal or on a close button.
 * - children: The content to be rendered inside the modal.
 *
 * Outputs:
 * - JSX for rendering the modal with its content when it is open. Returns null when the modal is closed.
 */

function Modal({ isOpen, onClose, children, className, noCloseIcon }) {
  const modalRef = useRef(null);

  //Effect hook to handle clicks outside the modal to close it
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (modalRef.current && !modalRef.current.contains(e.target)) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [onClose]);

  //Return null if the modal is closed
  if (!isOpen) return null;

  //Render the modal with its content
  return (
    <div className={`modal`}>
      <div className={`modal-content ${className}`} ref={modalRef}>
        {!noCloseIcon && (
          <span className="close" id="close-modal" onClick={onClose}>
            &times;
          </span>
        )}
        {children}
      </div>
    </div>
  );
}

export default Modal;
