import React, { useState } from "react";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import prism from "react-syntax-highlighter/dist/esm/styles/prism/prism";
import "./Card.css"; // Add specific styles if needed

const ReusableComponentCard = ({ title, children, codeSnippet, className }) => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="component-card">
      <h2 onClick={() => setIsOpen(!isOpen)}>{title}</h2>
      {isOpen && (
        <>
          <div className={`component-content ${className}`}>{children}</div>
          <SyntaxHighlighter
            language="javascript"
            style={prism}
            customStyle={{
              overflowX: "hidden",
              fontSize: "0.95rem",
            }}
            wrapLongLines
          >
            {codeSnippet}
          </SyntaxHighlighter>
        </>
      )}
    </div>
  );
};

export default ReusableComponentCard;
