import React, { useState, useRef, useEffect } from "react";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import Button from "../../DevComponents/Button/Button";
import Modal from "../../DevComponents/Modal/Modal";
import prism from "react-syntax-highlighter/dist/esm/styles/prism/prism";
import "./Card.css"; // Add specific styles if needed

const ReusableComponentCard = ({
  title,
  children,
  codeSnippet,
  styleSnippet = "no styles",
  className,
}) => {
  const [isCodeOpen, setisCodeOpen] = useState(false);
  const [isStylingOpen, setisStylingOpen] = useState(false);

  return (
    <>
      <div className="component-card">
        <div className="component-card-header">
          <h2 onClick={() => setisCodeOpen(!isCodeOpen)}>{title}</h2>
          <Button onClick={() => setisCodeOpen(!isCodeOpen)}>Code</Button>
          <Button onClick={() => setisStylingOpen(!isStylingOpen)}>
            Styling
          </Button>
        </div>
        <div className={`component-content ${className}`}>{children}</div>
      </div>
      <Modal
        isOpen={isCodeOpen}
        onClose={() => setisCodeOpen(!isCodeOpen)}
        title="Code"
      >
        <SyntaxHighlighter
          language="javascript"
          style={prism}
          customStyle={{
            overflowX: "hidden",
            fontSize: window.innerWidth > 600 ? "1rem" : "0.6rem",
            margin: "0",
          }}
          wrapLongLines
        >
          {codeSnippet}
        </SyntaxHighlighter>
      </Modal>

      <Modal
        isOpen={isStylingOpen}
        onClose={() => setisStylingOpen(!isStylingOpen)}
        title="Styling"
      >
        <SyntaxHighlighter
          language="css"
          style={prism}
          customStyle={{
            overflowX: "hidden",
            fontSize: window.innerWidth > 600 ? "1rem" : "0.6rem",
            margin: "0",
          }}
          wrapLongLines={true}
        >
          {styleSnippet}
        </SyntaxHighlighter>
      </Modal>
    </>
  );
};

export default ReusableComponentCard;
