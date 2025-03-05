import React, { useEffect, useState } from "react";
import ReactDOMServer, { renderToString } from "react-dom/server";
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

const ComponentShowcase = () => {
  const [orientation, setOrientation] = useState("horizontal");
  const [contextMenu, setContextMenu] = useState({
    key: 0,
    visible: false,
    x: 0,
    y: 0,
  });
  const [cookieConsent, setCookieConsent] = useState(false);

  const alert = useAlert();

  const contextMenuOptions = [
    {
      label: "Copy",
      onClick: () => alert.showAlert("info", "Copied!"),
      icon: "fa-solid fa-copy",
    },
    {
      label: "Paste",
      onClick: () => alert.showAlert("info", "Pasted!"),
      icon: "fa-solid fa-paste",
    },
    {
      label: "Delete",
      onClick: () => alert.showAlert("error", "Deleted!"),
      icon: "fa-solid fa-trash",
    },
  ];

  return (
    <div className="showcase-container">
      <h1>Reusable React Components Showcase</h1>
      {/* <RadioGroup
        options={[
          { value: "horizontal-grid", label: "Horizontal" },
          { value: "vertical-grid", label: "Vertical" },
        ]}
        onChange={(value) => setOrientation(value)}
        multiSelect={false}
      /> */}
      <div
        className={`showcase-grid ${orientation}`}
        style={{
          display: "grid",
          gap: "1rem",
        }}
      >
        <Card
          title="Button"
          codeSnippet={buttonString}
          styleSnippet={buttonCSS}
          className="row"
        >
          <Button
            onClick={() => alert.showAlert("success", "Button Clicked!")}
            color="success"
          >
            Success
          </Button>
          <Button
            onClick={() => alert.showAlert("warning", "Button Clicked!")}
            color="warning"
          >
            Warning
          </Button>
          <Button
            onClick={() => alert.showAlert("info", "Button Clicked!")}
            color="info"
          >
            Info
          </Button>
          <Button
            onClick={() => alert.showAlert("error", "Button Clicked!")}
            color="danger"
          >
            Error
          </Button>
        </Card>

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

        <Card
          title="Dropdown"
          codeSnippet={dropdownString}
          styleSnippet={dropdownCSS}
        >
          <Dropdown
            options={["Option 1", "Option 2", "Option 3"]}
            onClick={(s) => console.log("Selected:", s)}
            listType="checkbox"
          >
            Dropdown Checkbox
          </Dropdown>

          <Dropdown
            options={["Option 1", "Option 2", "Option 3"]}
            onClick={(s) => console.log("Selected:", s)}
            enableSearch
          >
            Dropdown List
          </Dropdown>
        </Card>

        <Card
          title="Theme Switch"
          codeSnippet={themeSwitchString}
          styleSnippet={themeSwitchCSS}
        >
          <ThemeSwitch />
        </Card>

        <Card
          title="TimePicker"
          codeSnippet={timePickerString}
          styleSnippet={timePickerCSS}
        >
          <TimePicker label="Time Picker" />
        </Card>

        <Card title="DatePicker" codeSnippet="" styleSnippet="">
          <DatePicker label="Date Picker" />
        </Card>

        <Card
          title="Radio Group"
          codeSnippet={radioGroupString}
          styleSnippet={radioGroupCSS}
        >
          <RadioGroup
            options={[
              { value: "option 1", label: "Option 1" },
              { value: "option 2", label: "Option 2" },
              { value: "option 3", label: "Option 3" },
            ]}
          />
        </Card>

        <Card
          title="Context Menu"
          codeSnippet={contextMenuString}
          styleSnippet={contextMenuCSS}
        >
          <div
            className="context-menu-source-container"
            onContextMenu={(e) => {
              e.preventDefault();
              console.log(e);
              setContextMenu({
                key: 1,
                visible: true,
                x: e.clientX,
                y: e.clientY,
                circleMode: true,
              });
            }}
          >
            Circle Context Menu
          </div>
          <div
            className="context-menu-source-container"
            onContextMenu={(e) => {
              e.preventDefault();

              setContextMenu({
                key: 2,
                visible: true,
                x: e.clientX,
                y: e.clientY,
              });
            }}
          >
            Normal Context Menu
          </div>

          <ContextMenu
            contextMenuProps={contextMenu}
            onRequestClose={() =>
              setContextMenu({ ...contextMenu, visible: false })
            }
            options={contextMenuOptions}
          />
        </Card>

        <Card
          title="Cookie Consent"
          codeSnippet={cookieConsentString}
          styleSnippet={cookieConsentCSS}
        >
          <Button onClick={() => setCookieConsent(!cookieConsent)}>
            Show Cookie Consent
          </Button>

          <CookieConsent force={cookieConsent} />
        </Card>

        <Card
          title="Video Player"
          codeSnippet={videoPlayerString}
          styleSnippet={videoPlayerCSS}
        >
          <VideoPlayer videoSource="https://www.w3schools.com/tags/mov_bbb.mp4" />
        </Card>
      </div>
    </div>
  );
};

export default ComponentShowcase;
