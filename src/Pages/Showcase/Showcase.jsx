import React, { useEffect, useState } from "react";
import Card from "../../Components/Card/Card";
import Button from "../../DevComponents/Button/Button";
import Dropdown from "../../DevComponents/Dropdown/Dropdown";
import Input from "../../DevComponents/Input/Input";
import ThemeSwitch from "../../DevComponents/ThemeSwitch/ThemeSwitch";
import TimePicker from "../../DevComponents/TimePicker/TimePicker";
import RadioGroup from "../../DevComponents/RadioGroup/RadioGroup";
import ContextMenu from "../../DevComponents/ContextMenu/ContextMenu";

import { useAlert } from "../../DevComponents/Providers/Alert";
import "./Showcase.css";

const ComponentShowcase = () => {
  const [orientation, setOrientation] = useState("horizontal");
  const [contextMenu, setContextMenu] = useState({
    key: 0,
    visible: false,
    x: 0,
    y: 0,
  });

  const alert = useAlert();

  const buttonString = `<Button 
  onClick={() => alert.showAlert("success", "Button Clicked!")}
  color="success"
>
  Success
</Button>`;

  const dropdownString = `<Dropdown
  options={['Option 1', 'Option 2', 'Option 3']}
  onClick={s => console.log('Selected:', s)}
>
  Dropdown Button
</Dropdown>`;

  const inputString = `<Input label="Standard" />
<Input label="Textarea" type="textarea" />
<Input
  type="select"
  options={[
    { value: "option 1", label: "Option 1" },
    { value: "option 2", label: "Option 2" },
    { value: "option 3", label: "Option 3" },
  ]}
/>`;

  const radioGroupString = `<RadioGroup
  options={[
    { value: "option 1", label: "Option 1" },
    { value: "option 2", label: "Option 2" },
    { value: "option 3", label: "Option 3" },
  ]}
/>`;

  const contextMenuString = `<div
  className="context-menu-source-container"
  onContextMenu={(e) => {
    e.preventDefault();
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
>
  Normal Context Menu
</div>

<ContextMenu
  contextMenuProps={contextMenu}
  onRequestClose={() =>
    setContextMenu({ ...contextMenu, visible: false })
  }
/>`;

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
      <RadioGroup
        options={[
          { value: "horizontal-grid", label: "Horizontal" },
          { value: "vertical-grid", label: "Vertical" },
        ]}
        onChange={(value) => setOrientation(value)}
        multiSelect={false}
      />
      <div
        className={`showcase-grid ${orientation}`}
        style={{
          display: "grid",
          gap: "1rem",
        }}
      >
        <Card title="Button" codeSnippet={buttonString} className="row">
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

        <Card title="Input" codeSnippet={inputString}>
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

        <Card title="Dropdown" codeSnippet={dropdownString}>
          <Dropdown
            options={["Option 1", "Option 2", "Option 3"]}
            onClick={(s) => console.log("Selected:", s)}
            listType="checkbox"
          >
            Dropdown Button
          </Dropdown>
        </Card>

        <Card title="Theme Switch" codeSnippet={`<ThemeSwitch />`}>
          <ThemeSwitch />
        </Card>

        <Card
          title="TimePicker"
          codeSnippet={`<TimePicker label="Time Picker" />`}
        >
          <TimePicker label="Time Picker" />
        </Card>

        <Card title="Radio Group" codeSnippet={radioGroupString}>
          <RadioGroup
            options={[
              { value: "option 1", label: "Option 1" },
              { value: "option 2", label: "Option 2" },
              { value: "option 3", label: "Option 3" },
            ]}
          />
        </Card>

        <Card title="Context Menu" codeSnippet={contextMenuString}>
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

              console.log(e);
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
      </div>
    </div>
  );
};

export default ComponentShowcase;
