import React, { useEffect } from "react";
import "./Modal.css"; // Ensure your CSS styles are set up to handle these classes

const Modal = ({
  isOpen,
  onClose,
  headerContent = "header",
  footerContent = "footer",
  children,
}) => {
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (e.target.className === "modal") {
        onClose();
      }
    };
    window.addEventListener("click", handleClickOutside);
  }, []);
  if (!isOpen) return null;

  return (
    <div className="modal">
      <div className="modal-content">
        {headerContent && (
          <div className="modal-header">
            {typeof headerContent === "string" ? (
              <h2>{headerContent}</h2>
            ) : (
              headerContent
            )}
            <span className="close" onClick={onClose}>
              &times;
            </span>
          </div>
        )}
        <div className="modal-main">{children}</div>
        {footerContent && (
          <div className="modal-footer">
            {typeof footerContent === "string" ? (
              <h3>{footerContent}</h3>
            ) : (
              footerContent
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Modal;
