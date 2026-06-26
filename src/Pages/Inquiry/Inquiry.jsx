import React, { useState } from "react";
import "./Inquiry.css";

const InquiryPage = () => {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    projectDetails: "",
  });

  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSending(true);
    try {
      const response = await fetch("/api/inquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          email: formData.email,
          message: formData.projectDetails,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Something went wrong.");
      }
      setSubmitted(true);
    } catch (err) {
      setError(err.message || "Failed to send. Please try again.");
    } finally {
      setSending(false);
    }
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

          {error && <p className="error-message">{error}</p>}
          <button type="submit" disabled={sending}>
            {sending ? "Sending…" : "Send Inquiry"}
          </button>
        </form>
      )}
    </div>
  );
};

export default InquiryPage;
