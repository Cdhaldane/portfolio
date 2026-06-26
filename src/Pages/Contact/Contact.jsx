import React, { useState } from "react";
import { motion } from "framer-motion";
import { useAlert } from "../../DevComponents/Providers/Alert";
import Seo from "../../Components/Seo/Seo";

import "./Contact.css";

const CONTACT_EMAIL = "xcdhaldane@gmail.com";

// Same-origin Vercel serverless function (see /api/contact.js).
const CONTACT_ENDPOINT = "/api/contact";

const FORM_FIELDS = [
  { id: "user_name", label: "Your name", type: "text" },
  { id: "user_email", label: "Email address", type: "email" },
  { id: "message", label: "Tell me about your project", type: "textarea" },
];

const TITLE = "LET'S TALK";

// Material-style ripple: spawn an expanding circle at the pointer position.
const spawnRipple = (e) => {
  const host = e.currentTarget;
  const circle = document.createElement("span");
  const diameter = Math.max(host.clientWidth, host.clientHeight);
  const rect = host.getBoundingClientRect();
  circle.className = "ripple";
  circle.style.width = circle.style.height = `${diameter}px`;
  circle.style.left = `${e.clientX - rect.left - diameter / 2}px`;
  circle.style.top = `${e.clientY - rect.top - diameter / 2}px`;
  circle.addEventListener("animationend", () => circle.remove());
  host.appendChild(circle);
};

const Contact = () => {
  const [values, setValues] = useState({
    user_name: "",
    user_email: "",
    message: "",
    company: "", // honeypot — stays empty for real users
  });
  const [status, setStatus] = useState("idle"); // idle | sending | sent | error
  const [copied, setCopied] = useState(false);
  const alert = useAlert();

  const handleChange = (id) => (e) =>
    setValues((v) => ({ ...v, [id]: e.target.value }));

  const handleCopy = async (e) => {
    spawnRipple(e);
    try {
      await navigator.clipboard.writeText(CONTACT_EMAIL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert.showAlert("error", "Couldn't copy — please copy manually");
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!values.user_name || !values.user_email || !values.message) {
      alert.showAlert("error", "Please fill in all fields");
      return;
    }
    setStatus("sending");
    try {
      const res = await fetch(CONTACT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      setStatus("sent");
      setValues({ user_name: "", user_email: "", message: "", company: "" });
      setTimeout(() => setStatus("idle"), 3200);
    } catch (err) {
      console.error("Contact send failed:", err);
      setStatus("error");
      alert.showAlert("error", `Couldn't send — ${err.message}`);
      setTimeout(() => setStatus("idle"), 3200);
    }
  };

  let letterIndex = 0;

  return (
    <div className="cf">
      <Seo
        title="Contact"
        path="/contact"
        description="Get in touch with Charlie Haldane for web design and development in Peterborough, Ontario."
      />

      <div className="cf-aurora" aria-hidden="true">
        <span className="blob b1" />
        <span className="blob b2" />
        <span className="blob b3" />
      </div>
      <div className="cf-grid" aria-hidden="true" />

      <div className="cf-inner">
        {/* ---------------- LEFT: intro ---------------- */}
        <section className="cf-intro">
          <motion.p
            className="cf-eyebrow"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <span className="cf-dot" /> Available for new projects
          </motion.p>

          <h1 className="cf-title" aria-label={TITLE}>
            {TITLE.split("").map((ch) => {
              const delay = 0.15 + letterIndex * 0.045;
              letterIndex += 1;
              return ch === " " ? (
                <span className="cf-space" key={letterIndex}>
                  &nbsp;
                </span>
              ) : (
                <span
                  className="cf-letter"
                  key={letterIndex}
                  style={{ animationDelay: `${delay}s` }}
                >
                  {ch}
                </span>
              );
            })}
          </h1>

          <motion.p
            className="cf-lead"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4 }}
          >
            Need a well-designed, fast website — or just want to kick around an
            idea? Drop a line and I'll get back to you.
          </motion.p>

          <motion.button
            type="button"
            className="cf-email"
            onClick={handleCopy}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.55 }}
          >
            <i className="fa-regular fa-envelope" />
            <span className="cf-email-text">{CONTACT_EMAIL}</span>
            <span className={`cf-email-copied ${copied ? "show" : ""}`}>
              <i className="fa-solid fa-check" /> Copied
            </span>
          </motion.button>
        </section>

        {/* ---------------- RIGHT: form card ---------------- */}
        <motion.form
          className="cf-card"
          onSubmit={handleSubmit}
          noValidate
          initial="hidden"
          animate="show"
          variants={{
            hidden: {},
            show: { transition: { staggerChildren: 0.1, delayChildren: 0.25 } },
          }}
        >
          <motion.h2
            className="cf-card-title"
            variants={{
              hidden: { opacity: 0, y: 18 },
              show: { opacity: 1, y: 0 },
            }}
          >
            Start a conversation
          </motion.h2>

          {/* Honeypot — hidden from humans, catches bots. */}
          <input
            type="text"
            name="company"
            className="cf-hp"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            value={values.company}
            onChange={handleChange("company")}
          />

          {FORM_FIELDS.map((field) => (
            <motion.div
              className={`cf-field ${field.type === "textarea" ? "is-area" : ""}`}
              key={field.id}
              variants={{
                hidden: { opacity: 0, y: 18 },
                show: { opacity: 1, y: 0 },
              }}
              transition={{ type: "spring", stiffness: 120, damping: 18 }}
            >
              {field.type === "textarea" ? (
                <textarea
                  id={field.id}
                  className="cf-input"
                  placeholder=" "
                  rows={4}
                  value={values[field.id]}
                  onChange={handleChange(field.id)}
                />
              ) : (
                <input
                  id={field.id}
                  className="cf-input"
                  type={field.type}
                  placeholder=" "
                  value={values[field.id]}
                  onChange={handleChange(field.id)}
                />
              )}
              <label className="cf-label" htmlFor={field.id}>
                {field.label}
              </label>
              <span className="cf-underline" aria-hidden="true" />
            </motion.div>
          ))}

          <motion.div
            variants={{
              hidden: { opacity: 0, y: 18 },
              show: { opacity: 1, y: 0 },
            }}
          >
            <button
              type="submit"
              className={`cf-send is-${status}`}
              onClick={spawnRipple}
              disabled={status === "sending"}
            >
              <span className="cf-send-label">
                {status === "sending"
                  ? "Sending"
                  : status === "sent"
                  ? "Sent!"
                  : status === "error"
                  ? "Try again"
                  : "Send message"}
              </span>
              <span className="cf-send-icon" aria-hidden="true">
                {status === "sending" ? (
                  <i className="fa-solid fa-circle-notch fa-spin" />
                ) : status === "sent" ? (
                  <i className="fa-solid fa-check" />
                ) : (
                  <i className="fa-solid fa-paper-plane" />
                )}
              </span>
            </button>
          </motion.div>
        </motion.form>
      </div>
    </div>
  );
};

export default Contact;
