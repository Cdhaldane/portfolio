import React, { useState } from "react";
import "./Inquiry.css";

const InquiryPage = () => {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    projectDetails: "",
  });

  const [submitted, setSubmitted] = useState(false);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    // Here you can send the form data to an API or email service
    console.log("Form Submitted:", formData);
    setSubmitted(true);
  };

  return (
    <div className="inquiry-container">
      <h2>Let's Build Your Website!</h2>
      {submitted ? (
        <p className="success-message">Thank you! I'll be in touch soon.</p>
      ) : (
        <form onSubmit={handleSubmit} className="inquiry-form">
          <label>Name</label>
          <input
            type="text"
            name="name"
            value={formData.name}
            onChange={handleChange}
            required
          />

          <label>Email</label>
          <input
            type="email"
            name="email"
            value={formData.email}
            onChange={handleChange}
            required
          />

          <label>Project Details</label>
          <textarea
            name="projectDetails"
            value={formData.projectDetails}
            onChange={handleChange}
            required
          ></textarea>

          <button type="submit">Send Inquiry</button>
        </form>
      )}
    </div>
  );
};

export default InquiryPage;
