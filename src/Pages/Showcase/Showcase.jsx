import React, { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import Seo from "../../Components/Seo/Seo";
import Card from "../../Components/Card/Card";
import Button from "../../DevComponents/Button/Button";
import Dropdown from "../../DevComponents/Dropdown/Dropdown";
import Input from "../../DevComponents/Input/Input";
import ThemeSwitch from "../../DevComponents/ThemeSwitch/ThemeSwitch";
import TimePicker from "../../DevComponents/TimePicker/TimePicker";
import DatePicker from "../../DevComponents/DatePicker/DatePicker";
import RadioGroup from "../../DevComponents/RadioGroup/RadioGroup";
import ContextMenu from "../../DevComponents/ContextMenu/ContextMenu";
import CookieConsent from "../../DevComponents/CookieConsent/CookieConsent";
import VideoPlayer from "../../DevComponents/VideoPlayer/VideoPlayer";

import { useAlert } from "../../DevComponents/Providers/Alert";
import "./Showcase.css";

// eslint-disable-next-line import/no-webpack-loader-syntax
import buttonCSS from "!!raw-loader!../../DevComponents/Button/Button.css";
// eslint-disable-next-line import/no-webpack-loader-syntax
import buttonString from "!!raw-loader!../../DevComponents/Button/Button.jsx";
// eslint-disable-next-line import/no-webpack-loader-syntax
import inputCSS from "!!raw-loader!../../DevComponents/Input/Input.css";
// eslint-disable-next-line import/no-webpack-loader-syntax
import inputString from "!!raw-loader!../../DevComponents/Input/Input.jsx";
// eslint-disable-next-line import/no-webpack-loader-syntax
import dropdownCSS from "!!raw-loader!../../DevComponents/Dropdown/Dropdown.css";
// eslint-disable-next-line import/no-webpack-loader-syntax
import dropdownString from "!!raw-loader!../../DevComponents/Dropdown/Dropdown.jsx";
// eslint-disable-next-line import/no-webpack-loader-syntax
import radioGroupCSS from "!!raw-loader!../../DevComponents/RadioGroup/RadioGroup.css";
// eslint-disable-next-line import/no-webpack-loader-syntax
import radioGroupString from "!!raw-loader!../../DevComponents/RadioGroup/RadioGroup.jsx";
// eslint-disable-next-line import/no-webpack-loader-syntax
import contextMenuCSS from "!!raw-loader!../../DevComponents/ContextMenu/ContextMenu.css";
// eslint-disable-next-line import/no-webpack-loader-syntax
import contextMenuString from "!!raw-loader!../../DevComponents/ContextMenu/ContextMenu.jsx";
// eslint-disable-next-line import/no-webpack-loader-syntax
import themeSwitchCSS from "!!raw-loader!../../DevComponents/ThemeSwitch/ThemeSwitch.css";
// eslint-disable-next-line import/no-webpack-loader-syntax
import themeSwitchString from "!!raw-loader!../../DevComponents/ThemeSwitch/ThemeSwitch.jsx";
// eslint-disable-next-line import/no-webpack-loader-syntax
import timePickerCSS from "!!raw-loader!../../DevComponents/TimePicker/TimePicker.css";
// eslint-disable-next-line import/no-webpack-loader-syntax
import timePickerString from "!!raw-loader!../../DevComponents/TimePicker/TimePicker.jsx";
// eslint-disable-next-line import/no-webpack-loader-syntax
import cookieConsentCSS from "!!raw-loader!../../DevComponents/CookieConsent/CookieConsent.css";
// eslint-disable-next-line import/no-webpack-loader-syntax
import cookieConsentString from "!!raw-loader!../../DevComponents/CookieConsent/CookieConsent.jsx";
// eslint-disable-next-line import/no-webpack-loader-syntax
import videoPlayerCSS from "!!raw-loader!../../DevComponents/VideoPlayer/VideoPlayer.css";
// eslint-disable-next-line import/no-webpack-loader-syntax
import videoPlayerString from "!!raw-loader!../../DevComponents/VideoPlayer/VideoPlayer.jsx";

const NAME = "COMPONENTS";

// A reveal wrapper so each card animates into view. Uses a CSS reveal (not a
// framer transform) so it settles at transform:none — otherwise it would
// become the containing block for the cards' position:fixed code modals.
const Cell = ({ children }) => (
  <div className="sk-cell" data-reveal>
    {children}
  </div>
);

const ComponentShowcase = () => {
  const [contextMenu, setContextMenu] = useState({
    key: 0,
    visible: false,
    x: 0,
    y: 0,
  });
  const [cookieConsent, setCookieConsent] = useState(false);
  const rootRef = useRef(null);

  const alert = useAlert();

  // Scroll-triggered reveal for the cards.
  useEffect(() => {
    const els = rootRef.current?.querySelectorAll("[data-reveal]") || [];
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const contextMenuOptions = [
    { label: "Copy", onClick: () => alert.showAlert("info", "Copied!"), icon: "fa-solid fa-copy" },
    { label: "Paste", onClick: () => alert.showAlert("info", "Pasted!"), icon: "fa-solid fa-paste" },
    { label: "Delete", onClick: () => alert.showAlert("error", "Deleted!"), icon: "fa-solid fa-trash" },
  ];

  return (
    <div className="sk" ref={rootRef}>
      <Seo
        title="Component Library"
        path="/showcase"
        description="A custom React component library by Charlie Haldane — buttons, inputs, date/time pickers, a video player, context menus and more, each with live demos and source."
      />

      <div className="sk-aurora" aria-hidden="true">
        <span className="blob b1" />
        <span className="blob b2" />
      </div>

      {/* ---------------- HERO ---------------- */}
      <header className="sk-hero">
        <motion.p
          className="sk-eyebrow"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <span className="dot" /> Hand-built · React · Dependency-light
        </motion.p>

        <h1 className="sk-title" aria-label={NAME}>
          {NAME.split("").map((ch, i) => (
            <span
              className="sk-letter"
              key={i}
              style={{ animationDelay: `${0.12 + i * 0.05}s` }}
            >
              {ch}
            </span>
          ))}
        </h1>

        <motion.p
          className="sk-lead"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.3 }}
        >
          A reusable React component library I've built and refined across client
          projects — fully custom, accessible and theme-aware. Every card below
          is a live, interactive demo; pop open the source or styles to see how
          it works.
        </motion.p>
      </header>

      {/* ---------------- GRID ---------------- */}
      <section className="sk-grid" aria-label="Components">
        <Cell>
          <Card title="Button" codeSnippet={buttonString} styleSnippet={buttonCSS} className="row">
            <Button onClick={() => alert.showAlert("success", "Button Clicked!")} color="success">
              Success
            </Button>
            <Button onClick={() => alert.showAlert("warning", "Button Clicked!")} color="warning">
              Warning
            </Button>
            <Button onClick={() => alert.showAlert("info", "Button Clicked!")} color="info">
              Info
            </Button>
            <Button onClick={() => alert.showAlert("error", "Button Clicked!")} color="danger">
              Error
            </Button>
          </Card>
        </Cell>

        <Cell>
          <Card title="Input" codeSnippet={inputString} styleSnippet={inputCSS}>
            <Input label="Standard" />
            <Input label="Textarea" type="textarea" />
            <Input
              type="select"
              options={[
                { value: "option 1", label: "Option 1" },
                { value: "option 2", label: "Option 2" },
                { value: "option 3", label: "Option 3" },
              ]}
            />
          </Card>
        </Cell>

        <Cell>
          <Card title="Dropdown" codeSnippet={dropdownString} styleSnippet={dropdownCSS}>
            <Dropdown
              options={["Option 1", "Option 2", "Option 3"]}
              onClick={(s) => alert.showAlert("info", `Selected: ${s}`)}
              listType="checkbox"
            >
              Dropdown Checkbox
            </Dropdown>
            <Dropdown
              options={["Option 1", "Option 2", "Option 3"]}
              onClick={(s) => alert.showAlert("info", `Selected: ${s}`)}
              enableSearch
            >
              Dropdown List
            </Dropdown>
          </Card>
        </Cell>

        <Cell>
          <Card title="Theme Switch" codeSnippet={themeSwitchString} styleSnippet={themeSwitchCSS}>
            <ThemeSwitch />
          </Card>
        </Cell>

        <Cell>
          <Card title="TimePicker" codeSnippet={timePickerString} styleSnippet={timePickerCSS}>
            <TimePicker label="Time Picker" />
          </Card>
        </Cell>

        <Cell>
          <Card title="DatePicker">
            <DatePicker label="Date Picker" />
          </Card>
        </Cell>

        <Cell>
          <Card title="Radio Group" codeSnippet={radioGroupString} styleSnippet={radioGroupCSS}>
            <RadioGroup
              options={[
                { value: "option 1", label: "Option 1" },
                { value: "option 2", label: "Option 2" },
                { value: "option 3", label: "Option 3" },
              ]}
            />
          </Card>
        </Cell>

        <Cell>
          <Card title="Context Menu" codeSnippet={contextMenuString} styleSnippet={contextMenuCSS}>
            <div
              className="context-menu-source-container"
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ key: 1, visible: true, x: e.clientX, y: e.clientY, circleMode: true });
              }}
            >
              Circle Context Menu
            </div>
            <div
              className="context-menu-source-container"
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ key: 2, visible: true, x: e.clientX, y: e.clientY });
              }}
            >
              Normal Context Menu
            </div>
            <ContextMenu
              contextMenuProps={contextMenu}
              onRequestClose={() => setContextMenu({ ...contextMenu, visible: false })}
              options={contextMenuOptions}
            />
          </Card>
        </Cell>

        <Cell>
          <Card title="Cookie Consent" codeSnippet={cookieConsentString} styleSnippet={cookieConsentCSS}>
            <Button onClick={() => setCookieConsent(!cookieConsent)}>Show Cookie Consent</Button>
            <CookieConsent force={cookieConsent} />
          </Card>
        </Cell>

        <Cell>
          <Card title="Video Player" codeSnippet={videoPlayerString} styleSnippet={videoPlayerCSS}>
            <VideoPlayer videoSource="https://www.w3schools.com/tags/mov_bbb.mp4" />
          </Card>
        </Cell>
      </section>
    </div>
  );
};

export default ComponentShowcase;
