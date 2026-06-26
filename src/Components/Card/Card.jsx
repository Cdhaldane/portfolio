import React, { useState } from "react";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import Modal from "../../DevComponents/Modal/Modal";
import prism from "react-syntax-highlighter/dist/esm/styles/prism/prism";
import "./Card.css";

/**
 * ReusableComponentCard — a clean frame around a live component demo, with
 * optional "Code" / "CSS" source viewers (shown only when a snippet exists).
 */
const ReusableComponentCard = ({
  title,
  children,
  codeSnippet,
  styleSnippet,
  className,
}) => {
  const [isCodeOpen, setIsCodeOpen] = useState(false);
  const [isStylingOpen, setIsStylingOpen] = useState(false);

  const highlighterStyle = {
    overflowX: "auto",
    fontSize: "0.85rem",
    margin: 0,
    background: "transparent",
  };

  return (
    <>
      <article className="component-card">
        <header className="component-card-header">
          <h2>{title}</h2>
          <div className="component-card-actions">
            {codeSnippet && (
              <button
                type="button"
                className="cc-action"
                onClick={() => setIsCodeOpen(true)}
              >
                <i className="fa-solid fa-code" /> Code
              </button>
            )}
            {styleSnippet && (
              <button
                type="button"
                className="cc-action"
                onClick={() => setIsStylingOpen(true)}
              >
                <i className="fa-brands fa-css3-alt" /> CSS
              </button>
            )}
          </div>
        </header>
        <div className={`component-content ${className || ""}`}>{children}</div>
      </article>

      <Modal isOpen={isCodeOpen} onClose={() => setIsCodeOpen(false)} title={`${title} — Code`}>
        <SyntaxHighlighter language="jsx" style={prism} customStyle={highlighterStyle} wrapLongLines>
          {codeSnippet || ""}
        </SyntaxHighlighter>
      </Modal>

      <Modal isOpen={isStylingOpen} onClose={() => setIsStylingOpen(false)} title={`${title} — Styles`}>
        <SyntaxHighlighter language="css" style={prism} customStyle={highlighterStyle} wrapLongLines>
          {styleSnippet || ""}
        </SyntaxHighlighter>
      </Modal>
    </>
  );
};

export default ReusableComponentCard;
