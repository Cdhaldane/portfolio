import React, { useState, useRef } from "react";
import { Link } from "react-router-dom";
import emailjs from "@emailjs/browser";
import { InputForm } from "../../DevComponents/Input/Input";
import { useAlert } from "../../DevComponents/Providers/Alert";

import "./Contact.css";

const Contact = () => {
  const [show, setShow] = useState(false);
  const alert = useAlert();

  const handleCopy = () => {
    navigator.clipboard.writeText("xcdhaldane@gmail.com");
    document.querySelector(".contact-copied").style.color = "#007bff";
  };

  const handleEmail = () => {
    setShow(!show);
  };

  const sendEmail = (values) => {
    if (!values?.user_name || !values?.user_email || !values?.message) {
      alert.showAlert("error", "Please fill in all fields");
      return;
    }

    // Create a new form element
    const mockForm = document.createElement("form");

    // Append hidden input fields with values
    Object.entries(values).forEach(([key, value]) => {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = key;
      input.value = value;
      mockForm.appendChild(input);
    });

    emailjs
      .sendForm(
        "service_7xvem3p",
        "template_5imqdhx",
        mockForm,
        "g49oHx9bZd0NTtYal"
      )
      .then(
        () => {
          alert.showAlert("success", "Email sent successfully");
        },
        (error) => {
          console.log(error.text);
          alert.showAlert("error", "Email failed to send");
        }
      );
  };

  const ContactForm = ({ show, onSubmit }) => {
    const handleSubmit = async (values) => {
      await onSubmit(values);
    };

    const formFields = [
      { id: "user_name", label: "Name", type: "text" },
      { id: "user_email", label: "Email", type: "email" },
      { id: "message", label: "Message", type: "textarea" },
    ];

    return (
      <div className={`contact-form ${show ? "visible" : "hidden"}`}>
        <InputForm
          id="Let's Build Your Website!"
          states={formFields}
          onSubmit={handleSubmit}
          buttonLabel="Send"
        />
      </div>
    );
  };

  return (
    <div className="landing-container">
      <div className="contact-container">
        <div className="contact-title">
          <h1>H</h1>
          <h1>e</h1>
          <h1>l</h1>
          <h1>l</h1>
          <h1>o</h1>
          <h1>.</h1>
        </div>
        <p>Need a well designed, efficient website? Get in touch.</p>
        <p>
          Email: <a onClick={handleCopy}>xcdhaldane@gmail.com</a>{" "}
          <span className="contact-copied">Copied</span>
        </p>
      </div>
      <ContactForm show={show} onSubmit={(e) => sendEmail(e)} />
    </div>
  );
};

export default Contact;
